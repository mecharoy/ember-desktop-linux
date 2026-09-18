fn main() {
    // Icon-only changes don't invalidate Cargo's fingerprint for this build
    // script, so swapping src-tauri/icons/* (Tauri default -> Ember flame)
    // never re-embedded the .ico into ember.exe. Watch the icon explicitly.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    tauri_build::build()
}
