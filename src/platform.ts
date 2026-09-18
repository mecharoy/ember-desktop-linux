/** Display label for the capture hotkey. Must match capture_modifiers() in
 * src-tauri/src/lib.rs: Cmd on macOS, Ctrl everywhere else. */
export function captureHotkeyLabel(): string {
  return /Mac/.test(navigator.userAgent) ? "Cmd+Shift+J" : "Ctrl+Shift+J";
}
