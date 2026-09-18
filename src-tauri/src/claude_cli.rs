// The "Claude subscription" provider: runs the `claude` command-line tool
// headlessly and streams its output back to the webview as events.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{Emitter, Manager};
use tokio::io::AsyncBufReadExt;

#[cfg(target_os = "windows")]
use crate::CREATE_NO_WINDOW;

// ---------- locating the `claude` binary ----------
//
// std::process::Command (and tokio's wrapper around it) only ever tries the
// literal name passed to `new()`. On Windows that is a real problem for
// `claude`: both the native installer and npm typically land a `claude.cmd`
// or `claude.ps1` shim, and CreateProcess does not consult PATHEXT the way a
// shell does — so `Command::new("claude")` fails with "not found" even
// though `claude` runs fine when typed into cmd/PowerShell (rust-lang/rust#122660,
// rust-lang/rust#104358). That mismatch — works in a terminal, fails from the
// app — is exactly the symptom this fixes.
//
// A second, independent failure mode: a GUI process launched from a desktop
// shortcut or the Start Menu inherits the environment block Explorer had
// *at the time Explorer itself started* (or last refreshed it). If `claude`
// was installed after that — common right after a fresh Windows setup — the
// new PATH entry exists in the registry but never reaches the already-running
// Explorer/this app until logoff or reboot. So beyond PATHEXT-aware PATH
// search (via the `which` crate), we also probe the known install locations
// for each install method directly, by path, independent of PATH entirely.
fn claude_install_candidates() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    #[cfg(target_os = "windows")]
    {
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let profile = PathBuf::from(profile);
            dirs.push(profile.join(".local").join("bin")); // native installer (current default)
            dirs.push(profile.join(".claude").join("local")); // older native installer layout
        }
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs.push(PathBuf::from(appdata).join("npm")); // npm -g on Windows
        }
        if let Some(localappdata) = std::env::var_os("LOCALAPPDATA") {
            let localappdata = PathBuf::from(localappdata);
            dirs.push(localappdata.join("Microsoft").join("WinGet").join("Links")); // winget
            dirs.push(localappdata.join("Programs").join("claude-code"));
        }
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            dirs.push(home.join(".local").join("bin")); // native installer
            dirs.push(home.join(".claude").join("local"));
        }
        dirs.push(PathBuf::from("/opt/homebrew/bin")); // Homebrew, Apple Silicon
        dirs.push(PathBuf::from("/usr/local/bin")); // Homebrew, Intel; also common npm -g prefix
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            dirs.push(home.join(".local").join("bin")); // native installer
            dirs.push(home.join(".claude").join("local"));
        }
        dirs.push(PathBuf::from("/usr/local/bin"));
        dirs.push(PathBuf::from("/usr/bin")); // apt/dnf/apk packages
    }

    dirs
}

/// Resolves the `claude` executable: an explicit override from Settings first
/// (if the user has pointed us at a specific file), then a PATHEXT-aware PATH
/// search, then the known per-platform install locations above. Re-resolves
/// on every call rather than caching, so installing/updating Claude Code
/// while Ember is running is picked up without a restart.
fn resolve_claude_binary(cli_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(p) = cli_path.map(str::trim).filter(|p| !p.is_empty()) {
        let path = PathBuf::from(p);
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!("The custom claude path in Settings doesn't exist: {p}"))
        };
    }

    if let Ok(found) = which::which("claude") {
        return Ok(found);
    }

    for dir in claude_install_candidates() {
        if let Ok(found) = which::which_in("claude", Some(&dir), &dir) {
            return Ok(found);
        }
    }

    Err(
        "claude CLI not found. Install Claude Code (https://claude.com/download or \
         `npm install -g @anthropic-ai/claude-code`), or set a custom path in Settings."
            .to_string(),
    )
}

#[derive(serde::Serialize)]
pub struct ClaudeCliInfo {
    version: String,
    path: String,
}

/// `claude --version` — used by the Settings page to confirm Claude Code is
/// installed before offering the "claude-subscription" provider. Returns the
/// resolved path alongside the version so a mismatched install is visible
/// rather than silently guessed at. Runs with CREATE_NO_WINDOW on Windows so
/// clicking "Check claude CLI" doesn't flash a console.
#[tauri::command]
pub async fn claude_cli_version(cli_path: Option<String>) -> Result<ClaudeCliInfo, String> {
    let binary = resolve_claude_binary(cli_path.as_deref())?;
    let mut cmd = tokio::process::Command::new(&binary);
    cmd.arg("--version");
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let output = cmd.output().await;

    match output {
        Ok(o) if o.status.success() => Ok(ClaudeCliInfo {
            version: String::from_utf8_lossy(&o.stdout).trim().to_string(),
            path: binary.to_string_lossy().into_owned(),
        }),
        Ok(o) => Err(format!(
            "claude --version exited with {}: {}",
            o.status,
            String::from_utf8_lossy(&o.stderr).trim()
        )),
        Err(e) => Err(format!("Found {} but couldn't run it: {e}", binary.display())),
    }
}

/// Opens a normal, visible terminal running bare `claude` so its own
/// first-run login flow (opens the Anthropic login page in the user's
/// browser, per code.claude.com/docs/en/authentication) takes over. We never
/// parse, capture, or forward anything from this process; the CLI writes its
/// own credentials file and Ember never touches it. This is the mechanism
/// behind the "Open Claude Code sign-in" button in onboarding and Settings.
///
/// This one is *meant* to be visible — Claude Code's login only works
/// interactively (it waits for you in the terminal and opens your browser),
/// so the window has to show up. It's not a bug; see CLI_HINT-adjacent UI
/// copy in Settings.tsx / Onboarding.tsx for the in-app explanation shown
/// right before this fires.
#[tauri::command]
pub async fn claude_open_login(cli_path: Option<String>) -> Result<String, String> {
    let binary = resolve_claude_binary(cli_path.as_deref())?;

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "Sign in to Claude"])
            .arg("cmd")
            .args(["/K"])
            .arg(&binary)
            .spawn()
            .map_err(|e| format!("Could not open a terminal: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        let script = format!(
            "tell application \"Terminal\" to do script \"{}\"",
            binary.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"")
        );
        std::process::Command::new("osascript")
            .args(["-e", &script])
            .spawn()
            .map_err(|e| format!("Could not open Terminal.app: {e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if !crate::terminal::open(&[binary.to_string_lossy().into_owned()]) {
            return Err(format!(
                "Couldn't find a terminal to open automatically. Run `{}` in a terminal yourself to sign in.",
                binary.display()
            ));
        }
    }

    Ok("Opened a sign-in window. Finish logging in there (it'll open your browser), then come back here.".to_string())
}

/// Runs the official Claude Code installer (code.claude.com/docs/en/setup) in
/// a visible terminal — the exact same command a user would type themselves.
/// Ember never touches PATH, the registry, or any system state directly; it
/// only opens the terminal. Used by the "Install Claude Code" button that
/// appears wherever `resolve_claude_binary` comes back empty. Deliberately
/// visible for the same reason as claude_open_login above.
#[tauri::command]
pub async fn claude_install() -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args([
                "/C",
                "start",
                "Install Claude Code",
                "powershell",
                "-NoExit",
                "-Command",
                "irm https://claude.ai/install.ps1 | iex",
            ])
            .spawn()
            .map_err(|e| format!("Could not open PowerShell: {e}"))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("osascript")
            .args([
                "-e",
                "tell application \"Terminal\" to do script \"curl -fsSL https://claude.ai/install.sh | bash\"",
            ])
            .spawn()
            .map_err(|e| format!("Could not open Terminal.app: {e}"))?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        if !crate::terminal::open_script("curl -fsSL https://claude.ai/install.sh | bash") {
            return Err(
                "Couldn't find a terminal to open automatically. Run `curl -fsSL https://claude.ai/install.sh | bash` yourself.".to_string(),
            );
        }
    }

    Ok("Opened the Claude Code installer in a terminal. Once it finishes, click \"Check claude CLI\" and then \"Open Claude Code sign-in\".".to_string())
}

/// In-flight `claude` chat processes, keyed by request id, so the UI's Stop
/// button (claude_cli_cancel) can kill the child instead of letting it run to
/// completion in the background.
pub struct CliJobs(pub Mutex<HashMap<String, tokio::sync::oneshot::Sender<()>>>);

#[tauri::command]
pub fn claude_cli_cancel(state: tauri::State<CliJobs>, request_id: String) -> Result<(), String> {
    if let Some(tx) = state.0.lock().unwrap().remove(&request_id) {
        let _ = tx.send(());
    }
    Ok(())
}

/// Spawns `claude -p --output-format stream-json --verbose
/// --include-partial-messages` and streams each stdout line to the webview as
/// a `claude-chat:{request_id}` event, so src/ai/providers/
/// claudeSubscription.ts can turn it into an AsyncIterable. Runs with
/// Both the request id and the CLI's session id end up in a file name or on
/// a command line, so neither is taken on trust: crypto.randomUUID() and the
/// CLI's own session ids are both hex-and-dashes, and nothing else is.
fn is_uuid_shaped(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// CREATE_NO_WINDOW on Windows — this fires on every single chat turn, so a
/// flashing console here (the original bug) is not acceptable.
///
/// Privacy/containment details, all deliberate:
/// - The prompt goes over STDIN and the system prompt via a private temp file
///   (`--system-prompt-file`), never as process arguments — on Windows any
///   local process can read another process's command line, and long
///   transcripts would blow the ~32K argument limit anyway.
/// - `--tools ""` disables every built-in tool. Without it, headless mode
///   auto-allows read-only tools (Read/Glob/Grep/web), which would let a chat
///   turn read files or reach the network.
/// - `--strict-mcp-config` drops the user's own MCP servers. `--tools` only
///   selects from the *built-in* set, so without this every MCP server in
///   their global config was loaded on every chat turn — measured at ~2,250
///   tokens per message here, and it put whatever those servers expose
///   (mail, files, calendars) inside a journaling session.
/// - `--setting-sources ""` and `--disable-slash-commands` drop their user/
///   project settings, plugins, hooks and skill catalog for the same two
///   reasons: another ~3,700 tokens a turn, and none of it is ours.
/// - `--resume` (turn 2+) continues the CLI session instead of replaying the
///   transcript, so the prefix is a cache read. Together these took a turn
///   from ~6,600 billed tokens to a few hundred.
/// - The working directory is a dedicated empty subdir (not the app data dir
///   itself, which holds ember.db) so no unrelated project's CLAUDE.md/hooks/
///   MCP config is picked up and nothing sensitive sits in cwd.
/// - Deliberately NOT run with `--bare`: bare mode skips OAuth/keychain reads
///   and requires an ANTHROPIC_API_KEY instead, which defeats the entire
///   point of this provider (using the user's existing `claude login`
///   subscription session rather than separately-billed API access).
#[tauri::command]
pub async fn claude_cli_chat(
    app: tauri::AppHandle,
    request_id: String,
    system_prompt: String,
    prompt: String,
    cli_path: Option<String>,
    model: Option<String>,
    resume_session_id: Option<String>,
) -> Result<(), String> {
    // request_id names the temp file and the event channel — only accept the
    // crypto.randomUUID() shape our own frontend generates.
    if !is_uuid_shaped(&request_id) {
        return Err("Invalid request id.".to_string());
    }
    // Same shape check before this reaches a command line: the CLI's own
    // session ids are UUIDs, and anything else is not ours to pass through.
    let resume = match resume_session_id.as_deref().map(str::trim) {
        Some(id) if !id.is_empty() => {
            if !is_uuid_shaped(id) {
                return Err("Invalid resume session id.".to_string());
            }
            Some(id.to_string())
        }
        _ => None,
    };

    let binary = resolve_claude_binary(cli_path.as_deref())?;
    let cwd = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Could not resolve app data dir: {e}"))?
        .join("claude-cwd");
    std::fs::create_dir_all(&cwd).map_err(|e| format!("Could not create CLI workdir: {e}"))?;

    let system_prompt_file = cwd.join(format!("system-{request_id}.txt"));
    std::fs::write(&system_prompt_file, &system_prompt)
        .map_err(|e| format!("Could not write the system prompt file: {e}"))?;

    let mut cmd = tokio::process::Command::new(&binary);
    cmd.current_dir(&cwd)
        .arg("-p")
        .arg("--system-prompt-file")
        .arg(&system_prompt_file)
        .arg("--tools")
        .arg("")
        .arg("--strict-mcp-config")
        .arg("--setting-sources")
        .arg("")
        .arg("--disable-slash-commands")
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Some(m) = model.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        cmd.arg("--model").arg(m);
    }
    // Turn 2+ of the same chat: continue the CLI's own session instead of
    // replaying the transcript. The prefix is then a prompt-cache *read*
    // rather than a re-write, which is where nearly all the per-turn cost
    // went before.
    if let Some(id) = resume.as_deref() {
        cmd.arg("--resume").arg(id);
    }
    #[cfg(target_os = "windows")]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let mut child = cmd.spawn().map_err(|e| {
        let _ = std::fs::remove_file(&system_prompt_file);
        format!("Found {} but couldn't start it: {e}", binary.display())
    })?;

    // Feed the prompt concurrently — writing before reading could deadlock on
    // full pipe buffers if the CLI ever emits output while stdin is open.
    if let Some(mut stdin) = child.stdin.take() {
        tauri::async_runtime::spawn(async move {
            use tokio::io::AsyncWriteExt;
            let _ = stdin.write_all(prompt.as_bytes()).await;
            let _ = stdin.shutdown().await;
        });
    }

    let stdout = child.stdout.take().ok_or("claude process had no stdout")?;
    let stderr = child.stderr.take().ok_or("claude process had no stderr")?;
    let event_name = format!("claude-chat:{request_id}");
    let app_for_task = app.clone();

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    app.state::<CliJobs>()
        .0
        .lock()
        .unwrap()
        .insert(request_id.clone(), cancel_tx);

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
                line = out_lines.next_line() => {
                    match line {
                        Ok(Some(l)) => {
                            if !l.trim().is_empty() {
                                let _ = app_for_task.emit(
                                    &event_name,
                                    serde_json::json!({ "kind": "line", "data": l }),
                                );
                            }
                        }
                        _ => break,
                    }
                }
                line = err_lines.next_line() => {
                    if let Ok(Some(l)) = line {
                        stderr_text.push_str(&l);
                        stderr_text.push('\n');
                    }
                }
            }
        }

        let wait_result = child.wait().await;
        let _ = std::fs::remove_file(&system_prompt_file);
        app_for_task
            .state::<CliJobs>()
            .0
            .lock()
            .unwrap()
            .remove(&request_id);

        match wait_result {
            // A user-initiated stop is a normal ending, not an error.
            _ if cancelled => {
                let _ = app_for_task.emit(&event_name, serde_json::json!({ "kind": "done" }));
            }
            Ok(status) if status.success() => {
                let _ = app_for_task.emit(&event_name, serde_json::json!({ "kind": "done" }));
            }
            Ok(status) => {
                let _ = app_for_task.emit(
                    &event_name,
                    serde_json::json!({
                        "kind": "error",
                        "message": format!("claude exited with {status}: {}", stderr_text.trim())
                    }),
                );
            }
            Err(e) => {
                let _ = app_for_task.emit(
                    &event_name,
                    serde_json::json!({ "kind": "error", "message": e.to_string() }),
                );
            }
        }
    });

    Ok(())
}
