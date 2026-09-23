# Elytra

Write it down. Let it open.

A journal you talk to. The Linux app, with a companion Android app.

**Ember users:** Elytra is the same app, renamed. Your entries, notes and settings are untouched.
The Arch package upgrades Ember in place. If another package manager leaves both
installed, remove Ember: both read the same journal. Daily backups now go to `Documents/Elytra`;
anything already in `Documents/Ember` still restores.

Jot quick notes during the day: press Ctrl+Shift+J anywhere (on Wayland, see LINUX.md), or use the tray icon. In the evening Elytra asks you a few questions about your day, then writes the entry for you on a handwritten page. Over time it picks up your moods, habits, sleep and the people and themes that keep coming up.

## Download

Get the latest from [Releases](https://github.com/mecharoy/ember-desktop-linux/releases): a `.deb` (Debian, Ubuntu), an `.rpm` (Fedora), an AppImage (any distro) or an Arch package (`.pkg.tar.zst`). Elytra checks this repo for new versions and tells you when one is out. LINUX.md has the details for Arch and for the distro packages Elytra needs.

## AI

Pick one in Settings:

- **Local model.** [Ollama](https://ollama.com/download) on your computer. Elytra starts it and keeps your model loaded while Elytra is open, and unloads it when you quit. Nothing leaves the computer.
- **Free hosted model.** A free key from [Groq](https://console.groq.com/keys), [Google AI Studio](https://aistudio.google.com/apikey), [OpenRouter](https://openrouter.ai/keys), [Cerebras](https://cloud.cerebras.ai) or [Mistral](https://console.mistral.ai/api-keys).
- **Claude subscription.** Your Claude Pro or Max plan, through Claude Code.
- **Anthropic.** An [Anthropic](https://console.anthropic.com) API key.

Keys stay in your system's keychain. Your journal is a SQLite database on your computer. Export everything any time from Settings.

## Your phone

On the computer, open Settings → Sync with phone and press "Pair a phone". On the phone, enter the code in Settings → Sync with computer. While both are on the same network:

- the journal syncs both ways, and
- the phone can chat with the local model running on the computer, so a phone gets a model it could never run itself.

The two talk directly over your network, encrypted with a key only they share. Campus and office Wi-Fi often block devices from reaching each other; use your phone's hotspot there.

Elytra is a reflection tool, not therapy.

## Build

Needs Node 22+ and Rust.

```bash
npm ci
npm run tauri build
```

`npm test` runs the tests. `npm run tauri dev` opens the app.

## Credits

- WHO-5 Well-Being Index © World Health Organization, CC BY-NC-SA 3.0 IGO (non-commercial use).
- PHQ-9 and GAD-7 by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc.
- Fonts: Newsreader and Caveat (SIL Open Font License).

## License

[MIT](LICENSE)
