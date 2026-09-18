// The "ChatGPT subscription" provider: runs OpenAI's `codex` command-line
// tool headlessly (`codex exec --json`) and streams its event lines back to
// the webview. Same shape as claude_cli.rs.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tokio::io::AsyncBufReadExt;

#[cfg(target_os = "windows")]
use crate::CREATE_NO_WINDOW;

/// Where codex usually lands when PATH in this process is out of date (an
/// install after Explorer started): npm's global folder, Homebrew and the
/// user's local bin.
fn codex_install_candidates() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm"));
        }
        if let Some(localappdata) = std::env::var_os("LOCALAPPDATA") {
            dirs.push(PathBuf::from(localappdata).join("Microsoft").join("WinGet").join("Links"));
        }
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            dirs.push(PathBuf::from(profile).join(".local").join("bin"));
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            dirs.push(home.join(".local").join("bin"));
            dirs.push(home.join(".npm-global").join("bin"));
        }
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    dirs
}

fn resolve_codex_binary(cli_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = cli_path.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(p);
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!("The custom codex path in Settings doesn't exist: {p}"))
        };
    }
    if let Ok(found) = which::which("codex") {
        return Ok(found);
    }
    for dir in codex_install_candidates() {
        if let Ok(found) = which::which_in("codex", Some(&dir), &dir) {
            return Ok(found);
        }
    }
    Err("Codex CLI not found. Install it (`npm install -g @openai/codex`), or set a custom path in Settings.".to_string())
}

#[derive(serde::Serialize)]
pub struct CodexCliInfo {
    version: String,
    path: String,
}

#[tauri::command]
pub async fn codex_cli_version(cli_path: Option<String>) -> Result<CodexCliInfo, String> {
    let binary = resolve_codex_binary(cli_path.as_deref())?;
    let mut cmd = tokio::process::Command::new(&binary);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    match cmd.output().await {
        Ok(o) if o.status.success() => Ok(CodexCliInfo {
            version: String::from_utf8_lossy(&o.stdout).trim().to_string(),
            path: binary.to_string_lossy().into_owned(),
        }),
        Ok(o) => Err(format!("codex --version exited with {}: {}", o.status, String::from_utf8_lossy(&o.stderr).trim())),
        Err(e) => Err(format!("Found {} but couldn't run it: {e}", binary.display())),
    }
}

/// Opens a visible terminal running a command line. Sign-in and install
/// are interactive, so the window is meant to show.
fn open_terminal(title: &str, command: &str) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", title, "cmd", "/K", command])
            .spawn()
            .map_err(|e| format!("Could not open a terminal: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        let _ = title;
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            command.replace('\\', "\\\\").replace('"', "\\\"")
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("Could not open Terminal.app: {e}"))?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = title;
        if !crate::terminal::open_script(command) {
            return Err(format!("Couldn't open a terminal. Run `{command}` yourself."));
        }
    }
    Ok(())
}

/// `codex login` in a terminal: it opens the ChatGPT sign-in page in the
/// browser. Ember never sees the credentials; codex keeps its own.
#[tauri::command]
pub async fn codex_open_login(cli_path: Option<String>) -> Result<String, String> {
    let binary = resolve_codex_binary(cli_path.as_deref())?;
    let quoted = format!("\"{}\" login", binary.to_string_lossy());
    open_terminal("Sign in to Codex", &quoted)?;
    Ok("Opened a sign-in window. Finish signing in there (it opens your browser), then come back.".to_string())
}

#[tauri::command]
pub async fn codex_install() -> Result<String, String> {
    open_terminal("Install Codex", "npm install -g @openai/codex")?;
    Ok("Opened the installer in a terminal (it needs Node.js). When it finishes, check again.".to_string())
}

pub struct CodexJobs(pub Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>);

#[tauri::command]
pub fn codex_cli_cancel(state: tauri::State<CodexJobs>, request_id: String) -> Result<(), String> {
    if let Some(tx) = state.0.lock().unwrap().remove(&request_id) {
        let _ = tx.send(());
    }
    Ok(())
}

fn is_id_shaped(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Spawns `codex exec --json` and sends each stdout line to the webview as a
/// `codex-chat:{request_id}` event (src/ai/providers/codexSubscription.ts).
/// - The whole prompt, instructions included, goes over STDIN (`-`), never
///   as an argument: other processes can read command lines, and long
///   conversations would pass the argument length limit.
/// - `--sandbox read-only` and an empty working folder: nothing to read or
///   change there, and codex can't write anywhere.
/// - `--ephemeral`: codex keeps no session file of the conversation.
/// - `--skip-git-repo-check`: the folder isn't a repository, on purpose.
#[tauri::command]
pub async fn codex_cli_chat(
    app: tauri::AppHandle,
    request_id: String,
    prompt: String,
    cli_path: Option<String>,
    model: Option<String>,
) -> Result<(), String> {
    if !is_id_shaped(&request_id) {
        return Err("Invalid request id.".to_string());
    }
    let binary = resolve_codex_binary(cli_path.as_deref())?;
    let cwd = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?
        .join("codex-cwd");
    std::fs::create_dir_all(&cwd).map_err(|e| format!("Could not create the Codex folder: {e}"))?;

    let mut cmd = tokio::process::Command::new(&binary);
    cmd.current_dir(&cwd)
        .arg("exec")
        .arg("--json")
        .arg("--skip-git-repo-check")
        .arg("--ephemeral")
        .arg("--sandbox")
        .arg("read-only")
        .arg("-c")
        .arg("model_reasoning_effort=\"low\"")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(m) = model.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        if !m.chars().all(|c| c.is_ascii_alphanumeric() || "-._:/".contains(c)) {
            return Err("Invalid model name.".to_string());
        }
        cmd.arg("--model").arg(m);
    }
    cmd.arg("-");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| format!("Found {} but couldn't start it: {e}", binary.display()))?;
    if let Some(mut stdin) = child.stdin.take() {
        tauri::async_runtime::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(prompt.as_bytes()).await;
            let _ = stdin.shutdown().await;
        });
    }

    let stdout = child.stdout.take().ok_or("codex had no stdout")?;
    let stderr = child.stderr.take().ok_or("codex had no stderr")?;
    let event_name = format!("codex-chat:{request_id}");
    let app_for_task = app.clone();
    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    app.state::<CodexJobs>().0.lock().unwrap().insert(request_id.clone(), cancel_tx);

    tauri::async_runtime::spawn(async move {
        let mut out_lines = tokio::io::BufReader::new(stdout).lines();
        let mut err_lines = tokio::io::BufReader::new(stderr).lines();
        let mut stderr_text = String::new();
        let mut cancelled = false;
        loop {
            tokio::select! {
                _ = &mut cancel_rx, if !cancelled => {
                    cancelled = true;
                    let _ = child.start_kill();
                }
                line = out_lines.next_line() => match line {
                    Ok(Some(l)) => {
                        if !l.trim().is_empty() {
                            let _ = app_for_task.emit(&event_name, serde_json::json!({ "kind": "line", "data": l }));
                        }
                    }
                    _ => break,
                },
                line = err_lines.next_line() => {
                    if let Ok(Some(l)) = line {
                        if stderr_text.len() < 4000 {
                            stderr_text.push_str(&l);
                            stderr_text.push('\n');
                        }
                    }
                }
            }
        }
        let wait_result = child.wait().await;
        app_for_task.state::<CodexJobs>().0.lock().unwrap().remove(&request_id);
        let payload = match wait_result {
            _ if cancelled => serde_json::json!({ "kind": "done" }),
            Ok(status) if status.success() => serde_json::json!({ "kind": "done" }),
            Ok(status) => serde_json::json!({
                "kind": "error",
                "message": format!("codex exited with {status}: {}", stderr_text.trim())
            }),
            Err(e) => serde_json::json!({ "kind": "error", "message": e.to_string() }),
        };
        let _ = app_for_task.emit(&event_name, payload);
    });
    Ok(())
}
