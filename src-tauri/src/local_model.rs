// Keeps the local model (Ollama) ready while Elytra is open: starts Ollama if
// it isn't running, loads the chosen model, and lets it go again on quit.
// Also the path a paired phone's chat takes to reach that model.

use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::sync::oneshot;

#[cfg(target_os = "windows")]
use crate::CREATE_NO_WINDOW;

/// How long Ollama keeps the model after the last request. Elytra refreshes it
/// well within this while open, so a crashed Elytra doesn't pin it for ever.
pub const KEEP_ALIVE: &str = "15m";

#[derive(Clone)]
struct Config {
    host: String,
    model: String,
    num_ctx: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    /// off | starting | loading | ready | not-installed | not-running | no-model | error
    state: String,
    message: String,
    model: String,
    models: Vec<String>,
}

impl Default for ModelStatus {
    fn default() -> Self {
        Self { state: "off".into(), message: String::new(), model: String::new(), models: Vec::new() }
    }
}

#[derive(Default)]
struct Inner {
    config: Option<Config>,
    status: ModelStatus,
    /// Ollama started by Elytra, stopped again on quit.
    spawned: Option<std::process::Child>,
}

#[derive(Clone)]
pub struct LocalModel {
    inner: Arc<Mutex<Inner>>,
    http: reqwest::Client,
    /// Chats in progress, so Stop (or a conversation pre-empting a job) can end them.
    chats: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
}

impl Default for LocalModel {
    fn default() -> Self {
        Self {
            inner: Arc::default(),
            chats: Arc::default(),
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(4))
                .build()
                .expect("http client"),
        }
    }
}

fn is_this_computer(host: &str) -> bool {
    let rest = host.trim_start_matches("http://").trim_start_matches("https://");
    rest.starts_with("localhost") || rest.starts_with("127.0.0.1") || rest.starts_with("[::1]")
}

fn ollama_binary() -> Option<PathBuf> {
    if let Ok(found) = which::which("ollama") {
        return Some(found);
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "windows")]
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("Programs").join("Ollama").join("ollama.exe"));
    }
    #[cfg(target_os = "macos")]
    candidates.extend([
        PathBuf::from("/Applications/Ollama.app/Contents/Resources/ollama"),
        PathBuf::from("/opt/homebrew/bin/ollama"),
        PathBuf::from("/usr/local/bin/ollama"),
    ]);
    #[cfg(all(unix, not(target_os = "macos")))]
    candidates.extend([PathBuf::from("/usr/local/bin/ollama"), PathBuf::from("/usr/bin/ollama")]);
    candidates.into_iter().find(|p| p.is_file())
}

/// "llama3.1" names the same model as "llama3.1:latest".
fn same_model(a: &str, b: &str) -> bool {
    let norm = |s: &str| if s.contains(':') { s.to_string() } else { format!("{s}:latest") };
    norm(a) == norm(b)
}

impl LocalModel {
    fn set_status(&self, state: &str, message: impl Into<String>, models: Vec<String>) -> ModelStatus {
        let mut inner = self.inner.lock().unwrap();
        inner.status = ModelStatus {
            state: state.into(),
            message: message.into(),
            model: inner.config.as_ref().map(|c| c.model.clone()).unwrap_or_default(),
            models,
        };
        inner.status.clone()
    }

    async fn reachable(&self, host: &str) -> bool {
        self.http
            .get(format!("{host}/api/version"))
            .timeout(Duration::from_secs(3))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
    }

    async fn installed_models(&self, host: &str) -> Result<Vec<String>, String> {
        let body: Value = self
            .http
            .get(format!("{host}/api/tags"))
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        Ok(body["models"]
            .as_array()
            .map(|list| list.iter().filter_map(|m| m["name"].as_str().map(String::from)).collect())
            .unwrap_or_default())
    }

    fn start_ollama(&self) -> Result<(), String> {
        if let Some(child) = self.inner.lock().unwrap().spawned.as_mut() {
            if matches!(child.try_wait(), Ok(None)) {
                return Ok(()); // already starting
            }
        }
        let binary = ollama_binary().ok_or("not-installed")?;
        let mut cmd = std::process::Command::new(binary);
        cmd.arg("serve")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let child = cmd.spawn().map_err(|e| format!("Couldn't start Ollama: {e}"))?;
        self.inner.lock().unwrap().spawned = Some(child);
        Ok(())
    }

    pub async fn prepare(&self, host: String, model: String, num_ctx: u32) -> ModelStatus {
        let host = host.trim().trim_end_matches('/').to_string();
        let num_ctx = num_ctx.clamp(2048, 131_072);
        self.inner.lock().unwrap().config = Some(Config { host: host.clone(), model: model.clone(), num_ctx });

        if !self.reachable(&host).await {
            if !is_this_computer(&host) {
                return self.set_status("not-running", format!("Nothing answers at {host}."), Vec::new());
            }
            self.set_status("starting", "Starting Ollama…", Vec::new());
            match self.start_ollama() {
                Err(e) if e == "not-installed" => {
                    return self.set_status("not-installed", "Ollama isn't installed on this computer.", Vec::new())
                }
                Err(e) => return self.set_status("error", e, Vec::new()),
                Ok(()) => {}
            }
            let mut up = false;
            for _ in 0..40 {
                tokio::time::sleep(Duration::from_millis(500)).await;
                if self.reachable(&host).await {
                    up = true;
                    break;
                }
            }
            if !up {
                return self.set_status("not-running", "Ollama was started but didn't answer within 20 seconds.", Vec::new());
            }
        }

        let models = match self.installed_models(&host).await {
            Ok(m) => m,
            Err(e) => return self.set_status("error", format!("Couldn't list Ollama's models: {e}"), Vec::new()),
        };
        if model.trim().is_empty() {
            return self.set_status("no-model", "Pick a model.", models);
        }
        if !models.iter().any(|m| same_model(m, &model)) {
            return self.set_status("no-model", format!("\"{model}\" isn't downloaded. Run: ollama pull {model}"), models);
        }

        self.set_status("loading", format!("Loading {model}…"), models.clone());
        // An empty chat loads the model without generating anything.
        let loaded = self
            .http
            .post(format!("{host}/api/chat"))
            .timeout(Duration::from_secs(600))
            .json(&json!({ "model": model, "messages": [], "keep_alive": KEEP_ALIVE, "options": { "num_ctx": num_ctx } }))
            .send()
            .await;
        match loaded {
            Ok(r) if r.status().is_success() => self.set_status("ready", format!("{model} is loaded."), models),
            Ok(r) => {
                let status = r.status();
                let text = r.text().await.unwrap_or_default();
                self.set_status("error", format!("Ollama couldn't load {model} ({status}): {text}"), models)
            }
            Err(e) => self.set_status("error", format!("Ollama couldn't load {model}: {e}"), models),
        }
    }

    /// Unloads the model and stops an Ollama that Elytra started.
    pub async fn release(&self) {
        let (config, child) = {
            let mut inner = self.inner.lock().unwrap();
            inner.status = ModelStatus::default();
            (inner.config.take(), inner.spawned.take())
        };
        if let Some(c) = config {
            let _ = self
                .http
                .post(format!("{}/api/chat", c.host))
                .timeout(Duration::from_secs(3))
                .json(&json!({ "model": c.model, "messages": [], "keep_alive": 0 }))
                .send()
                .await;
        }
        if let Some(mut child) = child {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    pub fn status(&self) -> ModelStatus {
        self.inner.lock().unwrap().status.clone()
    }

    /// What a phone is told before it chats.
    pub fn status_json(&self) -> Value {
        let inner = self.inner.lock().unwrap();
        json!({
            "localModel": inner.config.is_some(),
            "model": inner.config.as_ref().map(|c| c.model.clone()),
            "state": inner.status.state,
            "message": inner.status.message,
        })
    }

    /// True while the computer uses a local model through Ollama.
    pub fn uses_local(&self) -> bool {
        self.inner.lock().unwrap().config.is_some()
    }

    /// Sends a phone's chat request to the model the computer uses. The phone
    /// builds the messages; the computer decides model, context size and how
    /// long the model stays loaded.
    pub async fn relay_chat(&self, mut body: Value) -> Result<reqwest::Response, (u16, String)> {
        let Some(config) = self.inner.lock().unwrap().config.clone() else {
            return Err((409, "The computer isn't using a local model.".into()));
        };
        if !body.is_object() {
            return Err((400, "Garbled chat request.".into()));
        }
        body["model"] = json!(config.model);
        body["keep_alive"] = json!(KEEP_ALIVE);
        if !body["options"].is_object() {
            body["options"] = json!({});
        }
        body["options"]["num_ctx"] = json!(config.num_ctx);
        let response = self
            .http
            .post(format!("{}/api/chat", config.host))
            .json(&body)
            .send()
            .await
            .map_err(|e| (502, format!("The computer couldn't reach Ollama: {e}")))?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let text = response.text().await.unwrap_or_default();
            let detail = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v["error"].as_str().map(String::from))
                .unwrap_or(text);
            return Err((status, detail));
        }
        Ok(response)
    }
}

#[tauri::command]
pub async fn local_model_prepare(
    model_state: tauri::State<'_, LocalModel>,
    host: String,
    model: String,
    num_ctx: u32,
) -> Result<ModelStatus, String> {
    Ok(model_state.inner().clone().prepare(host, model, num_ctx).await)
}

#[tauri::command]
pub fn local_model_status(model_state: tauri::State<'_, LocalModel>) -> ModelStatus {
    model_state.status()
}

#[tauri::command]
pub async fn local_model_release(model_state: tauri::State<'_, LocalModel>) -> Result<(), String> {
    model_state.inner().clone().release().await;
    Ok(())
}

// ---------- chat requests from this computer's webview ----------
//
// Sent from Rust rather than the webview's fetch: the installed app's pages
// come from http://tauri.localhost, and Ollama refuses (403) requests whose
// Origin isn't on its own list. Requests from here carry no Origin.

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatEvent {
    Status { status: u16, error: Option<String> },
    Line { line: String },
    Done,
    Error { message: String },
}

async fn run_local_chat(
    http: &reqwest::Client,
    host: &str,
    body: Value,
    on_event: &Channel<ChatEvent>,
    cancel: &mut oneshot::Receiver<()>,
) -> Result<(), String> {
    let request = http.post(format!("{host}/api/chat")).json(&body).send();
    let mut response = tokio::select! {
        _ = &mut *cancel => return Ok(()),
        r = request => r.map_err(|_| format!("Could not reach Ollama at {host}."))?,
    };
    let status = response.status().as_u16();
    if !response.status().is_success() {
        let text = response.text().await.unwrap_or_default();
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v["error"].as_str().map(String::from))
            .unwrap_or(text);
        let _ = on_event.send(ChatEvent::Status { status, error: Some(detail) });
        return Ok(());
    }
    let _ = on_event.send(ChatEvent::Status { status, error: None });
    let mut pending: Vec<u8> = Vec::new();
    loop {
        let chunk = tokio::select! {
            _ = &mut *cancel => return Ok(()), // dropping the response stops the model
            c = response.chunk() => c,
        };
        match chunk {
            Ok(Some(bytes)) => {
                pending.extend_from_slice(&bytes);
                while let Some(nl) = pending.iter().position(|b| *b == b'\n') {
                    let line: Vec<u8> = pending.drain(..=nl).collect();
                    let text = String::from_utf8_lossy(&line).trim().to_string();
                    if !text.is_empty() {
                        let _ = on_event.send(ChatEvent::Line { line: text });
                    }
                }
            }
            Ok(None) => {
                let rest = String::from_utf8_lossy(&pending).trim().to_string();
                if !rest.is_empty() {
                    let _ = on_event.send(ChatEvent::Line { line: rest });
                }
                return Ok(());
            }
            Err(e) => return Err(format!("Ollama stopped partway through the reply: {e}")),
        }
    }
}

/// Streams Ollama's /api/chat reply lines to `on_event`. Only addresses on
/// this computer, like the rest of Elytra's local model settings.
#[tauri::command]
pub async fn local_chat(
    model_state: tauri::State<'_, LocalModel>,
    host: String,
    request_id: String,
    body: Value,
    on_event: Channel<ChatEvent>,
) -> Result<(), String> {
    let host = host.trim().trim_end_matches('/').to_string();
    if !is_this_computer(&host) {
        return Err("Ollama's address must be on this computer.".into());
    }
    if request_id.is_empty() || request_id.len() > 64 || !request_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid request id.".into());
    }
    let model = model_state.inner().clone();
    let (cancel_tx, mut cancel_rx) = oneshot::channel();
    model.chats.lock().unwrap().insert(request_id.clone(), cancel_tx);
    let result = run_local_chat(&model.http, &host, body, &on_event, &mut cancel_rx).await;
    model.chats.lock().unwrap().remove(&request_id);
    match &result {
        Ok(()) => {
            let _ = on_event.send(ChatEvent::Done);
        }
        Err(message) => {
            let _ = on_event.send(ChatEvent::Error { message: message.clone() });
        }
    }
    result
}

#[tauri::command]
pub fn local_chat_cancel(model_state: tauri::State<'_, LocalModel>, request_id: String) {
    if let Some(tx) = model_state.chats.lock().unwrap().remove(&request_id) {
        let _ = tx.send(());
    }
}
