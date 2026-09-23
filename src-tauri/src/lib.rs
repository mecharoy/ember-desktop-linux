// Elytra for the desktop: tray, capture hotkey, database migrations, the OS
// keychain, notifications, backups, the local model and the phone link.

mod claude_cli;
mod codex_cli;
mod lan_proto;
mod lan_server;
mod local_model;
#[cfg(all(unix, not(target_os = "macos")))]
mod terminal;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, PhysicalPosition, Position, WindowEvent,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

// CREATE_NO_WINDOW (Windows): child processes of a GUI app otherwise flash a
// console window. Used for the headless `claude` runs and `ollama serve`.
#[cfg(target_os = "windows")]
pub(crate) const CREATE_NO_WINDOW: u32 = 0x08000000;

// Must match `identifier` in tauri.conf.json, so this build never shares
// keychain entries with another Elytra.
pub(crate) const KEYRING_SERVICE: &str = "dev.abhij.ember.desktop";

fn migrations() -> Vec<Migration> {
    let files: [(i64, &str, &str); 14] = [
        (1, "initial schema", include_str!("../migrations/0001_initial.sql")),
        (2, "add entries.title", include_str!("../migrations/0002_add_entry_title.sql")),
        (3, "indexes for captures and messages", include_str!("../migrations/0003_indexes.sql")),
        (4, "task reminders", include_str!("../migrations/0004_reminders.sql")),
        (5, "capture external_id for mobile inbox sync", include_str!("../migrations/0005_capture_external_id.sql")),
        (6, "user reference documents", include_str!("../migrations/0006_documents.sql")),
        (7, "check-ins, habit prefs, review sources, monthly reports", include_str!("../migrations/0007_checkins_reviews.sql")),
        (8, "questionnaires, sleep diary, monthly formulation, memory summaries", include_str!("../migrations/0008_wellbeing_memory.sql")),
        (9, "paper colour per journal entry", include_str!("../migrations/0009_entry_paper.sql")),
        (10, "lunch, evening break and dinner in the check-in", include_str!("../migrations/0010_checkin_day_times.sql")),
        (11, "sync between computer and phone", include_str!("../migrations/0011_sync.sql")),
        (12, "sync state that outlives a reset", include_str!("../migrations/0012_sync_state.sql")),
        (13, "conversation checklist, topics and day notes", include_str!("../migrations/0013_checklist_topics.sql")),
        (14, "memory files, briefing and chat summary", include_str!("../migrations/0014_memory_files.sql")),
    ];
    files
        .into_iter()
        .map(|(version, description, sql)| Migration { version, description, sql, kind: MigrationKind::Up })
        .collect()
}

// ---------- capture bar ----------

/// Centered horizontally, one third down the primary monitor.
fn position_capture_bar(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("capture-bar") else {
        return;
    };
    let Ok(Some(monitor)) = window.primary_monitor() else {
        return;
    };
    let Ok(win_size) = window.outer_size() else {
        return;
    };
    let monitor_size = monitor.size();
    let monitor_pos = monitor.position();
    let x = monitor_pos.x + ((monitor_size.width as i32 - win_size.width as i32) / 2);
    let y = monitor_pos.y + (monitor_size.height as i32 / 3) - (win_size.height as i32 / 2);
    let _ = window.set_position(Position::Physical(PhysicalPosition { x, y }));
}

/// Cmd+Shift+J on macOS, Ctrl+Shift+J elsewhere.
fn capture_modifiers() -> Modifiers {
    if cfg!(target_os = "macos") {
        Modifiers::SUPER | Modifiers::SHIFT
    } else {
        Modifiers::CONTROL | Modifiers::SHIFT
    }
}

fn toggle_capture_bar(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("capture-bar") else {
        return;
    };
    match window.is_visible() {
        Ok(true) => {
            let _ = window.hide();
        }
        _ => {
            position_capture_bar(app);
            let _ = window.show();
            let _ = window.set_focus();
            let _ = app.emit("capture-bar:focus", ());
        }
    }
}

/// `ember-desktop --capture` toggles the capture bar. Wayland has no global
/// hotkeys for apps, so a compositor or desktop shortcut runs this instead.
const CAPTURE_FLAG: &str = "--capture";

/// False when the tray icon couldn't be made (no appindicator library): closing
/// the window then quits, since nothing else could bring it back.
struct TrayReady(AtomicBool);

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// ---------- OS keychain ----------

/// A missing Secret Service is the usual Linux failure; say what to install.
pub(crate) fn keyring_message(e: &keyring::Error) -> String {
    let text = e.to_string();
    if cfg!(target_os = "linux") && !matches!(e, keyring::Error::NoEntry) {
        return format!(
            "{text}. Elytra keeps keys in the Secret Service: install and start GNOME Keyring, KWallet or KeePassXC (Secret Service enabled)."
        );
    }
    text
}

/// Only these names: the webview can't use this as a general credential store.
fn keyring_entry(name: &str) -> Result<keyring::Entry, String> {
    if !matches!(name, "anthropic_api_key" | "cloud_api_key" | "openai_api_key" | "install_id") {
        return Err(format!("Unknown secret name: {name}"));
    }
    keyring::Entry::new(KEYRING_SERVICE, name).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_get(name: String) -> Result<Option<String>, String> {
    let entry = keyring_entry(&name)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(keyring_message(&e)),
    }
}

#[tauri::command]
fn secret_set(name: String, value: String) -> Result<(), String> {
    let entry = keyring_entry(&name)?;
    if value.is_empty() {
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keyring_message(&e)),
        };
    }
    entry.set_password(&value).map_err(|e| keyring_message(&e))
}

// ---------- notifications ----------

/// On Windows a "Reminder" toast stays on screen until acted on and plays the
/// reminder sound; elsewhere a plain notification. The body is only ever the
/// fixed evening line or the reminder text the user asked for.
#[tauri::command]
fn show_reminder_notification(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use tauri_winrt_notification::{Scenario, Sound, Toast};
        // An unbundled dev build has no registered app id, so it borrows PowerShell's.
        let app_id = if cfg!(debug_assertions) {
            Toast::POWERSHELL_APP_ID.to_string()
        } else {
            app.config().identifier.clone()
        };
        let open_app = app.clone();
        Toast::new(&app_id)
            .title(&title)
            .text1(&body)
            .scenario(Scenario::Reminder)
            .sound(Some(Sound::Reminder))
            .add_button("Open Elytra", "open")
            .add_button("Dismiss", "dismiss")
            .on_activated(move |action| {
                if action.as_deref() != Some("dismiss") {
                    show_main(&open_app);
                }
                Ok(())
            })
            .show()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        use tauri_plugin_notification::NotificationExt;
        app.notification()
            .builder()
            .title(&title)
            .body(&body)
            .show()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------- backups ----------
//
// The daily copy goes to Documents/Elytra/Elytra backup.db. A picked backup is
// first copied next to ember.db as STAGED_BACKUP, so the webview can show
// what's in it before anything is replaced.

// These two live next to the journal database and keep their original names:
// renaming them would orphan a restore that was already staged.
const STAGED_BACKUP: &str = "ember-restore-candidate.db";
const SNAPSHOT: &str = "ember-backup-snapshot.db";
/// The folder in Documents the daily copy goes to, and the one it used to.
const BACKUP_DIR: &str = "Elytra";
const LEGACY_BACKUP_DIR: &str = "Ember";

/// tauri-plugin-sql opens sqlite:ember.db in the app config dir.
fn db_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Could not find the app's data folder: {e}"))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// ~/Documents. Linux without xdg-user-dirs (a bare Arch install) has no
/// Documents entry, so fall back to $HOME/Documents.
fn documents_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = app.path().document_dir() {
        return Ok(dir);
    }
    app.path()
        .home_dir()
        .map(|home| home.join("Documents"))
        .map_err(|e| format!("Could not find the Documents folder: {e}"))
}

fn check_backup(bytes: &[u8]) -> Result<(), String> {
    if !bytes.starts_with(b"SQLite format 3\x00") {
        return Err("That file isn't a journal database.".into());
    }
    if !bytes.windows(20).any(|w| w == b"CREATE TABLE entries") {
        return Err("That database has no journal in it.".into());
    }
    Ok(())
}

/// An empty path for VACUUM INTO, which refuses to overwrite.
#[tauri::command]
fn backup_snapshot_path(app: tauri::AppHandle) -> Result<String, String> {
    let path = db_dir(&app)?.join(SNAPSHOT);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Could not clear the last snapshot: {e}"))?;
    }
    Ok(path.to_string_lossy().into_owned())
}

/// Moves the snapshot to Documents/Elytra, replacing the previous copy.
#[tauri::command]
fn backup_save_copy(app: tauri::AppHandle) -> Result<String, String> {
    let snapshot = db_dir(&app)?.join(SNAPSHOT);
    let dir = documents_dir(&app)?.join(BACKUP_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Could not create Documents/{BACKUP_DIR}: {e}"))?;
    let target = dir.join("Elytra backup.db");
    std::fs::copy(&snapshot, &target).map_err(|e| format!("Could not write the backup: {e}"))?;
    let _ = std::fs::remove_file(&snapshot);
    Ok(target.to_string_lossy().into_owned())
}

/// Where "Pick your backup" opens. Normally Documents/Elytra, but if that
/// folder isn't there yet and the old Documents/Ember is, it opens there
/// instead: the app was renamed, the backups people already have were not.
/// Restoring reads any journal database, whichever name it was saved under.
#[tauri::command]
fn backup_folder(app: tauri::AppHandle) -> Result<String, String> {
    let documents = documents_dir(&app)?;
    let dir = documents.join(BACKUP_DIR);
    if !dir.exists() {
        let legacy = documents.join(LEGACY_BACKUP_DIR);
        if legacy.is_dir() {
            return Ok(legacy.to_string_lossy().into_owned());
        }
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// Copies a picked backup's bytes aside, without touching ember.db.
/// The bytes of a picked backup, however the webview managed to send them.
///
/// Tauri only puts a `Uint8Array` in a RAW request body when it can use its
/// custom-protocol IPC. On Android it never can — the platform cannot read a
/// request body, so Tauri always falls back to `postMessage` — and on desktop
/// it drops to the same fallback permanently after any failure of that
/// protocol. Over `postMessage` the array arrives JSON-encoded, as a list of
/// numbers. Restoring a journal has to work on both paths, so this accepts
/// either rather than insisting on one. (Before this, restoring a backup could
/// not work on Android at all, and failed on desktop with "Expected the backup
/// file's bytes." whenever the custom protocol had fallen back.)
fn picked_bytes(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes.clone()),
        tauri::ipc::InvokeBody::Json(value) => {
            let list = value.as_array().ok_or("Expected the backup file's bytes.")?;
            let mut out = Vec::with_capacity(list.len());
            for n in list {
                let byte = n
                    .as_u64()
                    .and_then(|v| u8::try_from(v).ok())
                    .ok_or("The backup file's bytes were not readable.")?;
                out.push(byte);
            }
            Ok(out)
        }
    }
}
#[tauri::command]
fn backup_stage(app: tauri::AppHandle, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let bytes = picked_bytes(&request)?;
    check_backup(&bytes)?;
    std::fs::write(db_dir(&app)?.join(STAGED_BACKUP), &bytes).map_err(|e| format!("Could not copy the backup: {e}"))
}

/// Puts the staged backup in place of ember.db. The webview closes its
/// connections first and reloads afterwards, so migrations run on the
/// restored file. The replaced files are kept next to it as *.before-restore.
#[tauri::command]
fn backup_restore(app: tauri::AppHandle) -> Result<(), String> {
    let dir = db_dir(&app)?;
    let db = dir.join("ember.db");
    let incoming = dir.join(STAGED_BACKUP);
    let bytes = std::fs::read(&incoming).map_err(|e| format!("Could not read the picked backup: {e}"))?;
    check_backup(&bytes)?;
    for suffix in ["", "-wal", "-shm"] {
        let file = dir.join(format!("ember.db{suffix}"));
        if file.exists() {
            std::fs::rename(&file, dir.join(format!("ember.db{suffix}.before-restore")))
                .map_err(|e| format!("Could not set the current journal aside: {e}"))?;
        }
    }
    std::fs::rename(&incoming, &db).map_err(|e| format!("Could not put the backup in place: {e}"))?;
    Ok(())
}

/// The tray icon and its menu (Open / Quick note / Quit).
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let open_item = MenuItem::with_id(app, "open", "Open Elytra", true, None::<&str>)?;
    let capture_item = MenuItem::with_id(app, "capture", "Quick note", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_item, &capture_item, &quit_item])?;

    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Elytra")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_main(app),
            "capture" => toggle_capture_bar(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                toggle_capture_bar(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Quit from the tray: let the local model go first, then exit.
fn quit(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let model = app.state::<local_model::LocalModel>().inner().clone();
        let _ = tokio::time::timeout(std::time::Duration::from_secs(4), model.release()).await;
        app.exit(0);
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(claude_cli::CliJobs(Mutex::new(HashMap::new())))
        .manage(codex_cli::CodexJobs(Mutex::new(HashMap::new())))
        .manage(local_model::LocalModel::default())
        .manage(lan_server::Lan::default())
        // Must be the first plugin: launching Elytra again shows the running one.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if args.iter().any(|a| a == CAPTURE_FLAG) {
                toggle_capture_bar(app);
            } else {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if shortcut.matches(capture_modifiers(), Code::KeyJ) && event.state() == ShortcutState::Pressed {
                        toggle_capture_bar(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_http::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:ember.db", migrations())
                .build(),
        )
        .setup(|app| {
            // Another app holding the hotkey shouldn't stop Elytra; the tray still captures.
            if let Err(e) = app.global_shortcut().register(Shortcut::new(Some(capture_modifiers()), Code::KeyJ)) {
                eprintln!("Could not register the capture hotkey: {e}");
            }

            // A missing tray library panics rather than failing; either way keep going.
            let handle = app.handle().clone();
            let built = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| build_tray(&handle)));
            let tray_ok = matches!(built, Ok(Ok(())));
            if !tray_ok {
                eprintln!("Could not create the tray icon; closing the window will quit Elytra.");
            }
            app.manage(TrayReady(AtomicBool::new(tray_ok)));

            if std::env::args().any(|a| a == CAPTURE_FLAG) {
                if let Some(main) = app.get_webview_window("main") {
                    let _ = main.hide();
                }
                toggle_capture_bar(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| match window.label() {
            "main" => {
                // Closing the window keeps Elytra in the tray.
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let has_tray = window.app_handle().try_state::<TrayReady>().map_or(true, |t| t.0.load(Ordering::Relaxed));
                    if has_tray {
                        let _ = window.hide();
                    } else {
                        quit(window.app_handle());
                    }
                }
            }
            "capture-bar" => {
                if let WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            claude_cli::claude_cli_version,
            claude_cli::claude_cli_chat,
            claude_cli::claude_cli_cancel,
            claude_cli::claude_open_login,
            claude_cli::claude_install,
            codex_cli::codex_cli_version,
            codex_cli::codex_cli_chat,
            codex_cli::codex_cli_cancel,
            codex_cli::codex_open_login,
            codex_cli::codex_install,
            show_reminder_notification,
            secret_get,
            secret_set,
            backup_snapshot_path,
            backup_save_copy,
            backup_folder,
            backup_stage,
            backup_restore,
            local_model::local_model_prepare,
            local_model::local_model_status,
            local_model::local_model_release,
            local_model::local_chat,
            local_model::local_chat_cancel,
            lan_server::lan_enable,
            lan_server::lan_disable,
            lan_server::lan_info,
            lan_server::lan_pairing_start,
            lan_server::lan_pairing_stop,
            lan_server::lan_peer_remove,
            lan_server::lan_reply,
            lan_server::lan_chat_push,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
