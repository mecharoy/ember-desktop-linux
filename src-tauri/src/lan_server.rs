// The computer's side of the phone link: a small web server on the home
// network, off until the user turns it on in Settings.
//
//   GET  /ember/hello  who this is (unsealed; only the computer's name)
//   POST /ember/pair   a phone proves it has the code; gets the lasting key
//   POST /ember/call   sealed request, sealed reply (sync goes to the webview)
//   POST /ember/chat   sealed request, sealed stream from the computer's model:
//                      the local model directly, or else whatever AI provider
//                      Elytra on the computer uses (through the webview)
//
// A UDP responder on DISCOVERY_PORT answers phones looking for Elytra.

use crate::lan_proto::*;
use crate::local_model::LocalModel;
use axum::body::{Body, Bytes};
use axum::extract::{DefaultBodyLimit, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::oneshot;

const PEERS_SECRET: &str = "lan_peers";
const PAIRING_MINUTES: u64 = 10;
const MAX_PAIR_ATTEMPTS: u8 = 5;
const MAX_PEERS: usize = 4;
const REPLY_TIMEOUT: Duration = Duration::from_secs(90);

#[derive(Clone, Serialize, Deserialize)]
pub struct Peer {
    pub id: String,
    pub name: String,
    key: String,
    pub paired_at: u64,
    #[serde(default)]
    pub last_seen: u64,
}

struct Pairing {
    code: String,
    key: Key,
    expires: Instant,
    attempts: u8,
}

struct Running {
    port: u16,
    stop: Vec<oneshot::Sender<()>>,
}

#[derive(Default)]
struct Inner {
    running: Option<Running>,
    device_id: String,
    pairing: Option<Pairing>,
    peers: Option<Vec<Peer>>,
    pending: HashMap<String, oneshot::Sender<Result<Value, String>>>,
    /// Phone chats answered by the webview's provider, by request id.
    chats: HashMap<String, tokio::sync::mpsc::Sender<ChatPush>>,
    seen: VecDeque<(String, Instant)>,
}

#[derive(Clone, Default)]
pub struct Lan(Arc<Mutex<Inner>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerInfo {
    id: String,
    name: String,
    paired_at: u64,
    last_seen: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanInfo {
    enabled: bool,
    port: Option<u16>,
    addresses: Vec<String>,
    name: String,
    peers: Vec<PeerInfo>,
    pairing_code: Option<String>,
    pairing_seconds_left: Option<u64>,
    error: Option<String>,
}

pub fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Computer".to_string())
}

/// The address other devices on the network reach this one at. Connecting a
/// UDP socket sends nothing; it only asks the system which interface it would use.
fn local_addresses() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(socket) = std::net::UdpSocket::bind("0.0.0.0:0") {
        if socket.connect("192.168.0.1:9").is_ok() || socket.connect("10.0.0.1:9").is_ok() {
            if let Ok(addr) = socket.local_addr() {
                if !addr.ip().is_loopback() && !addr.ip().is_unspecified() {
                    out.push(addr.ip().to_string());
                }
            }
        }
    }
    out
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(crate::KEYRING_SERVICE, PEERS_SECRET).map_err(|e| e.to_string())
}

fn load_peers() -> Vec<Peer> {
    keyring_entry()
        .ok()
        .and_then(|e| e.get_password().ok())
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default()
}

fn store_peers(peers: &[Peer]) -> Result<(), String> {
    let entry = keyring_entry()?;
    if peers.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(crate::keyring_message(&e)),
        };
    }
    let json = serde_json::to_string(peers).map_err(|e| e.to_string())?;
    entry.set_password(&json).map_err(|e| crate::keyring_message(&e))
}

impl Lan {
    fn peers(inner: &mut Inner) -> &mut Vec<Peer> {
        inner.peers.get_or_insert_with(load_peers)
    }

    fn info(&self, error: Option<String>) -> LanInfo {
        let mut inner = self.0.lock().unwrap();
        if inner.pairing.as_ref().is_some_and(|p| p.expires <= Instant::now()) {
            inner.pairing = None;
        }
        let port = inner.running.as_ref().map(|r| r.port);
        let pairing = inner
            .pairing
            .as_ref()
            .map(|p| (p.code.clone(), p.expires.saturating_duration_since(Instant::now()).as_secs()));
        let peers = Self::peers(&mut inner)
            .iter()
            .map(|p| PeerInfo { id: p.id.clone(), name: p.name.clone(), paired_at: p.paired_at, last_seen: p.last_seen })
            .collect();
        LanInfo {
            enabled: port.is_some(),
            port,
            addresses: if port.is_some() { local_addresses() } else { Vec::new() },
            name: device_name(),
            peers,
            pairing_code: pairing.as_ref().map(|p| p.0.clone()),
            pairing_seconds_left: pairing.map(|p| p.1),
            error,
        }
    }

    fn fresh_request(&self, id: &str, ts: u64) -> bool {
        let now = now_secs();
        if ts + MAX_AGE_SECS < now || ts > now + MAX_AGE_SECS {
            return false;
        }
        let mut inner = self.0.lock().unwrap();
        let cutoff = Instant::now() - Duration::from_secs(MAX_AGE_SECS * 2);
        while inner.seen.front().is_some_and(|(_, at)| *at < cutoff) {
            inner.seen.pop_front();
        }
        if inner.seen.iter().any(|(seen, _)| seen == id) {
            return false;
        }
        inner.seen.push_back((id.to_string(), Instant::now()));
        true
    }

    fn peer_key(&self, peer_id: &str) -> Option<(Key, String)> {
        let mut inner = self.0.lock().unwrap();
        let peer = Self::peers(&mut inner).iter_mut().find(|p| p.id == peer_id)?;
        peer.last_seen = now_secs();
        let key = key_from_b64(&peer.key).ok()?;
        Some((key, peer.name.clone()))
    }
}

#[derive(Clone)]
struct Ctx {
    app: AppHandle,
    lan: Lan,
}

fn plain_error(status: StatusCode, message: &str) -> Response {
    (status, Json(json!({ "error": message }))).into_response()
}

async fn hello(State(ctx): State<Ctx>) -> Json<Value> {
    let inner = ctx.lan.0.lock().unwrap();
    Json(json!({
        "app": "ember",
        "role": "desktop",
        "id": inner.device_id,
        "name": device_name(),
        "version": ctx.app.package_info().version.to_string(),
        "pairing": inner.pairing.as_ref().is_some_and(|p| p.expires > Instant::now()),
    }))
}

#[derive(Deserialize)]
struct PairBody {
    phone_id: String,
    data: String,
}

#[derive(Deserialize)]
struct PairHello {
    phone_id: String,
    phone_name: String,
    ts: u64,
}

async fn pair(State(ctx): State<Ctx>, Json(body): Json<PairBody>) -> Response {
    let sealed = match unb64(&body.data) {
        Ok(s) => s,
        Err(e) => return plain_error(StatusCode::BAD_REQUEST, &e),
    };
    let (key, desktop_id) = {
        let mut inner = ctx.lan.0.lock().unwrap();
        let desktop_id = inner.device_id.clone();
        let Some(pairing) = inner.pairing.as_mut().filter(|p| p.expires > Instant::now()) else {
            return plain_error(StatusCode::FORBIDDEN, "No pairing code is active. Press \"Pair a phone\" on the computer.");
        };
        pairing.attempts += 1;
        if pairing.attempts > MAX_PAIR_ATTEMPTS {
            inner.pairing = None;
            return plain_error(StatusCode::FORBIDDEN, "Too many wrong codes. Start pairing again.");
        }
        (pairing.key, desktop_id)
    };
    let hello: PairHello = match open(&key, &pair_context(&body.phone_id), &sealed)
        .ok()
        .and_then(|plain| serde_json::from_slice(&plain).ok())
    {
        Some(h) => h,
        None => return plain_error(StatusCode::FORBIDDEN, "Wrong code."),
    };
    if hello.phone_id != body.phone_id || hello.ts + MAX_AGE_SECS < now_secs() {
        return plain_error(StatusCode::FORBIDDEN, "Wrong code.");
    }

    let lasting = random_key();
    {
        let mut inner = ctx.lan.0.lock().unwrap();
        inner.pairing = None;
        let peers = Lan::peers(&mut inner);
        peers.retain(|p| p.id != hello.phone_id);
        if peers.len() >= MAX_PEERS {
            peers.sort_by_key(|p| p.last_seen.max(p.paired_at));
            peers.remove(0);
        }
        peers.push(Peer {
            id: hello.phone_id.clone(),
            name: hello.phone_name.chars().take(60).collect(),
            key: b64(&lasting),
            paired_at: now_secs(),
            last_seen: now_secs(),
        });
        if let Err(e) = store_peers(peers) {
            return plain_error(StatusCode::INTERNAL_SERVER_ERROR, &format!("Couldn't save the pairing: {e}"));
        }
    }
    let _ = ctx.app.emit("lan:peers-changed", ());

    let reply = json!({ "desktop_id": desktop_id, "desktop_name": device_name(), "key": b64(&lasting) });
    let sealed = seal(&key, &pair_reply_context(&hello.phone_id), reply.to_string().as_bytes());
    Json(json!({ "data": b64(&sealed) })).into_response()
}

#[derive(Deserialize)]
struct SealedBody {
    peer: String,
    data: String,
}

#[derive(Deserialize)]
struct CallPlain {
    id: String,
    ts: u64,
    kind: String,
    #[serde(default)]
    payload: Value,
}

/// Unlocks a sealed request from a paired phone.
fn unseal(ctx: &Ctx, path: &str, body: &SealedBody) -> Result<(Key, String, CallPlain), Response> {
    let Some((key, name)) = ctx.lan.peer_key(&body.peer) else {
        return Err(plain_error(StatusCode::UNAUTHORIZED, "This phone is no longer paired. Pair it again."));
    };
    let plain = unb64(&body.data)
        .and_then(|sealed| open(&key, &call_context(path, &body.peer), &sealed))
        .map_err(|_| plain_error(StatusCode::UNAUTHORIZED, "This phone is no longer paired. Pair it again."))?;
    let call: CallPlain = serde_json::from_slice(&plain).map_err(|_| plain_error(StatusCode::BAD_REQUEST, "Garbled message."))?;
    if call.id.len() > 64 || !ctx.lan.fresh_request(&call.id, call.ts) {
        return Err(plain_error(StatusCode::FORBIDDEN, "Request expired. Check that both clocks are right."));
    }
    Ok((key, name, call))
}

async fn call(State(ctx): State<Ctx>, Json(body): Json<SealedBody>) -> Response {
    let (key, peer_name, call) = match unseal(&ctx, "call", &body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let result: Result<Value, String> = match call.kind.as_str() {
        "status" => Ok(ctx.app.state::<LocalModel>().status_json()),
        "sync" => {
            let (tx, rx) = oneshot::channel();
            ctx.lan.0.lock().unwrap().pending.insert(call.id.clone(), tx);
            let event = json!({
                "requestId": call.id,
                "peerId": body.peer,
                "peerName": peer_name,
                "kind": call.kind,
                "payload": call.payload,
            });
            if ctx.app.emit("lan:request", event).is_err() {
                Err("Elytra on the computer isn't ready.".into())
            } else {
                match tokio::time::timeout(REPLY_TIMEOUT, rx).await {
                    Ok(Ok(result)) => result,
                    _ => {
                        ctx.lan.0.lock().unwrap().pending.remove(&call.id);
                        Err("Elytra on the computer didn't answer in time.".into())
                    }
                }
            }
        }
        other => Err(format!("Unknown request \"{other}\".")),
    };
    let reply = match result {
        Ok(payload) => json!({ "ok": true, "payload": payload }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    let sealed = seal(&key, &reply_context(&call.id), reply.to_string().as_bytes());
    (StatusCode::OK, b64(&sealed)).into_response()
}

/// A piece of a phone chat answered by the webview (lan_chat_push).
pub enum ChatPush {
    Line(String),
    Done,
    Error(String),
}

/// How long the webview may go quiet mid-reply before the chat is given up.
const PUSH_TIMEOUT: Duration = Duration::from_secs(180);

async fn chat(State(ctx): State<Ctx>, Json(body): Json<SealedBody>) -> Response {
    let (key, _, call) = match unseal(&ctx, "chat", &body) {
        Ok(v) => v,
        Err(r) => return r,
    };
    // Background jobs on the model make way (desktopLink.ts).
    let _ = ctx.app.emit("lan:chat", ());
    let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(64);
    let model = ctx.app.state::<LocalModel>().inner().clone();
    let request_id = call.id.clone();

    if !model.uses_local() {
        // Not on a local model: Elytra's own provider answers in the webview
        // (desktopLink.ts) and pushes Ollama-shaped lines back here, so the
        // phone reads them exactly as it reads the local model.
        let (push_tx, mut push_rx) = tokio::sync::mpsc::channel::<ChatPush>(64);
        ctx.lan.0.lock().unwrap().chats.insert(request_id.clone(), push_tx);
        let asked = ctx.app.emit("lan:chat-request", json!({ "requestId": request_id, "body": call.payload }));
        let app = ctx.app.clone();
        let lan = ctx.lan.clone();
        tauri::async_runtime::spawn(async move {
            let mut seq = 0u64;
            let mut send = |kind: u8, data: &[u8]| {
                let f = frame(&key, &request_id, seq, kind, data);
                seq += 1;
                f
            };
            let finish = |lan: &Lan| {
                lan.0.lock().unwrap().chats.remove(&request_id);
            };
            if asked.is_err() {
                let status = send(FRAME_STATUS, br#"{"status":503,"error":"Elytra on the computer isn't ready."}"#);
                let _ = tx.send(status).await;
                let _ = tx.send(send(FRAME_END, b"")).await;
                finish(&lan);
                return;
            }
            if tx.send(send(FRAME_STATUS, br#"{"status":200}"#)).await.is_err() {
                finish(&lan);
                let _ = app.emit("lan:chat-cancel", json!({ "requestId": request_id }));
                return;
            }
            loop {
                let next = tokio::time::timeout(PUSH_TIMEOUT, push_rx.recv()).await;
                let (frame_bytes, last) = match next {
                    Ok(Some(ChatPush::Line(line))) => (send(FRAME_DATA, format!("{line}\n").as_bytes()), false),
                    Ok(Some(ChatPush::Done)) => (send(FRAME_END, b""), true),
                    Ok(Some(ChatPush::Error(message))) => (send(FRAME_ERROR, message.as_bytes()), true),
                    Ok(None) | Err(_) => (send(FRAME_ERROR, b"The computer's AI provider stopped answering."), true),
                };
                if tx.send(frame_bytes).await.is_err() {
                    // The phone hung up: stop the provider on the computer.
                    finish(&lan);
                    let _ = app.emit("lan:chat-cancel", json!({ "requestId": request_id }));
                    return;
                }
                if last {
                    finish(&lan);
                    return;
                }
            }
        });
        let stream = futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx).map(|o| o.map(|v| Ok::<_, std::convert::Infallible>(Bytes::from(v)))));
        return Response::builder()
            .status(StatusCode::OK)
            .header("content-type", "application/octet-stream")
            .body(Body::from_stream(stream))
            .unwrap();
    }

    tauri::async_runtime::spawn(async move {
        let mut seq = 0u64;
        let mut send = |kind: u8, data: &[u8]| {
            let f = frame(&key, &request_id, seq, kind, data);
            seq += 1;
            f
        };
        let upstream = model.relay_chat(call.payload).await;
        let mut response = match upstream {
            Ok(r) => r,
            Err((status, error)) => {
                let status_frame = send(FRAME_STATUS, json!({ "status": status, "error": error }).to_string().as_bytes());
                let end = send(FRAME_END, b"");
                let _ = tx.send(status_frame).await;
                let _ = tx.send(end).await;
                return;
            }
        };
        if tx.send(send(FRAME_STATUS, br#"{"status":200}"#)).await.is_err() {
            return;
        }
        loop {
            match response.chunk().await {
                Ok(Some(bytes)) => {
                    // The phone hung up: dropping the response stops the model.
                    if tx.send(send(FRAME_DATA, &bytes)).await.is_err() {
                        return;
                    }
                }
                Ok(None) => {
                    let _ = tx.send(send(FRAME_END, b"")).await;
                    return;
                }
                Err(e) => {
                    let _ = tx.send(send(FRAME_ERROR, format!("The local model stopped: {e}").as_bytes())).await;
                    return;
                }
            }
        }
    });

    let stream = futures_util::stream::poll_fn(move |cx| rx.poll_recv(cx).map(|o| o.map(|v| Ok::<_, std::convert::Infallible>(Bytes::from(v)))));
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "application/octet-stream")
        .body(Body::from_stream(stream))
        .unwrap()
}

async fn not_found(_: HeaderMap) -> Response {
    plain_error(StatusCode::NOT_FOUND, "Not an Elytra address.")
}

async fn discovery_responder(app: AppHandle, lan: Lan, mut stop: oneshot::Receiver<()>, port: u16) {
    let Ok(socket) = tokio::net::UdpSocket::bind(("0.0.0.0", DISCOVERY_PORT)).await else {
        eprintln!("Phone link: discovery port {DISCOVERY_PORT} is busy; phones can still connect by address.");
        return;
    };
    let mut buf = [0u8; 64];
    loop {
        tokio::select! {
            _ = &mut stop => return,
            got = socket.recv_from(&mut buf) => {
                let Ok((n, from)) = got else { continue };
                if &buf[..n] != DISCOVERY_ASK {
                    continue;
                }
                let id = lan.0.lock().unwrap().device_id.clone();
                let answer = json!({
                    "app": "ember",
                    "id": id,
                    "name": device_name(),
                    "port": port,
                    "version": app.package_info().version.to_string(),
                });
                let _ = socket.send_to(answer.to_string().as_bytes(), from).await;
            }
        }
    }
}

// ---------- commands ----------

#[tauri::command]
pub async fn lan_enable(app: AppHandle, lan: tauri::State<'_, Lan>, device_id: String) -> Result<LanInfo, String> {
    let lan = lan.inner().clone();
    if device_id.trim().is_empty() || device_id.len() > 64 {
        return Err("This install has no id yet.".into());
    }
    lan.0.lock().unwrap().device_id = device_id;
    if lan.0.lock().unwrap().running.is_some() {
        return Ok(lan.info(None));
    }

    let listener = match tokio::net::TcpListener::bind(("0.0.0.0", SERVER_PORT)).await {
        Ok(l) => l,
        Err(_) => tokio::net::TcpListener::bind(("0.0.0.0", 0))
            .await
            .map_err(|e| format!("Couldn't start phone sync: {e}"))?,
    };
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let ctx = Ctx { app: app.clone(), lan: lan.clone() };
    let router = Router::new()
        .route("/ember/hello", get(hello))
        .route("/ember/pair", post(pair))
        .route("/ember/call", post(call))
        .route("/ember/chat", post(chat))
        .fallback(not_found)
        .layer(DefaultBodyLimit::max(64 * 1024 * 1024))
        .with_state(ctx);

    let (stop_http, stop_http_rx) = oneshot::channel::<()>();
    let (stop_udp, stop_udp_rx) = oneshot::channel::<()>();
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(listener, router)
            .with_graceful_shutdown(async {
                let _ = stop_http_rx.await;
            })
            .await;
    });
    tauri::async_runtime::spawn(discovery_responder(app.clone(), lan.clone(), stop_udp_rx, port));

    lan.0.lock().unwrap().running = Some(Running { port, stop: vec![stop_http, stop_udp] });
    Ok(lan.info(None))
}

#[tauri::command]
pub fn lan_disable(lan: tauri::State<'_, Lan>) -> LanInfo {
    let running = {
        let mut inner = lan.0.lock().unwrap();
        inner.pairing = None;
        inner.running.take()
    };
    if let Some(r) = running {
        for stop in r.stop {
            let _ = stop.send(());
        }
    }
    lan.info(None)
}

#[tauri::command]
pub fn lan_info(lan: tauri::State<'_, Lan>) -> LanInfo {
    lan.info(None)
}

#[tauri::command]
pub async fn lan_pairing_start(lan: tauri::State<'_, Lan>) -> Result<LanInfo, String> {
    let lan = lan.inner().clone();
    let device_id = {
        let inner = lan.0.lock().unwrap();
        if inner.running.is_none() {
            return Err("Turn on phone sync first.".into());
        }
        inner.device_id.clone()
    };
    let code = new_pairing_code();
    let code_for_key = code.clone();
    // Stretching the code takes a moment; keep it off the async threads.
    let key = tauri::async_runtime::spawn_blocking(move || pairing_key(&code_for_key, &device_id))
        .await
        .map_err(|e| e.to_string())?;
    lan.0.lock().unwrap().pairing = Some(Pairing {
        code,
        key,
        expires: Instant::now() + Duration::from_secs(PAIRING_MINUTES * 60),
        attempts: 0,
    });
    Ok(lan.info(None))
}

#[tauri::command]
pub fn lan_pairing_stop(lan: tauri::State<'_, Lan>) -> LanInfo {
    lan.0.lock().unwrap().pairing = None;
    lan.info(None)
}

#[tauri::command]
pub fn lan_peer_remove(lan: tauri::State<'_, Lan>, id: String) -> Result<LanInfo, String> {
    let result = {
        let mut inner = lan.0.lock().unwrap();
        let peers = Lan::peers(&mut inner);
        peers.retain(|p| p.id != id);
        store_peers(peers)
    };
    Ok(lan.info(result.err()))
}

/// The webview's answer to a phone chat, a piece at a time: kind "line" (one
/// Ollama-shaped JSON line in `text`), "done" or "error".
#[tauri::command]
pub async fn lan_chat_push(
    lan: tauri::State<'_, Lan>,
    request_id: String,
    kind: String,
    text: Option<String>,
) -> Result<(), String> {
    let sender = {
        let mut inner = lan.0.lock().unwrap();
        if kind == "line" {
            inner.chats.get(&request_id).cloned()
        } else {
            inner.chats.remove(&request_id)
        }
    };
    let Some(sender) = sender else {
        return Err("gone".into());
    };
    let push = match kind.as_str() {
        "line" => ChatPush::Line(text.unwrap_or_default()),
        "done" => ChatPush::Done,
        _ => ChatPush::Error(text.unwrap_or_else(|| "The computer's AI provider failed.".into())),
    };
    sender.send(push).await.map_err(|_| "gone".to_string())
}

#[tauri::command]
pub fn lan_reply(lan: tauri::State<'_, Lan>, request_id: String, payload: Option<Value>, error: Option<String>) {
    if let Some(tx) = lan.0.lock().unwrap().pending.remove(&request_id) {
        let _ = tx.send(match error {
            Some(e) => Err(e),
            None => Ok(payload.unwrap_or(Value::Null)),
        });
    }
}
