# Ember on Linux (Arch and others)

This folder is `ember-desktop` with the changes Linux needs. Everything else is unchanged.

## Build and install (Arch)

```bash
sudo pacman -S --needed webkit2gtk-4.1 gtk3 libayatana-appindicator dbus openssl base-devel rust nodejs npm
cd packaging/arch && makepkg -si
```

Run without installing: `npm ci && npm run tauri dev`.
Other distros: Tauri 2 needs the WebKitGTK **4.1** dev package, GTK 3, libayatana-appindicator and libdbus dev files.

## What changed from the Windows/Mac version

| Area | Change |
|---|---|
| Keys, phone pairing keys | Stored in the Secret Service (GNOME Keyring, KWallet, KeePassXC). Before, they sat in the kernel keyring and vanished at reboot. Without a Secret Service, saving a key shows an error that says what to install. |
| Capture hotkey | Ctrl+Shift+J works on X11 only. On Wayland run `ember-desktop --capture` from a shortcut (see below). |
| Tray | Needs libayatana-appindicator. GNOME also needs the "AppIndicator and KStatusNotifierItem Support" extension. If no tray can be made, closing the window quits Ember. |
| Sign-in / installer terminal | Tries `$TERMINAL`, then kitty, alacritty, foot, konsole, gnome-terminal, wezterm, xfce4-terminal and others, each with its own flag. |
| Backups | Go to `~/Documents/Ember`. Falls back to `$HOME/Documents` when the system has no Documents folder set (bare Arch). |
| Blank window | `WEBKIT_DISABLE_DMABUF_RENDERER=1` is set at start unless you set it yourself. |
| Packaging | `packaging/arch/PKGBUILD`, `.desktop` file with a "Quick note" action. |

## Wayland capture shortcut

Bind a key to `ember-desktop --capture`. It toggles the capture bar in the running Ember (or starts Ember with only the bar).

- Hyprland: `bind = CTRL SHIFT, J, exec, ember-desktop --capture`
- Sway: `bindsym Ctrl+Shift+j exec ember-desktop --capture`
- KDE / GNOME: Settings > Keyboard > Custom shortcuts.

On Wayland the bar's position is chosen by the compositor. Starting Ember with `GDK_BACKEND=x11` (XWayland) restores exact placement.

## Phone sync

Open TCP 47821 and UDP 47820 on the firewall (ufw/firewalld/nftables) for the phone link. Ollama from the `ollama` package runs as a systemd service; Ember uses it when it is already up.

## Not yet tested

Written on Windows with no Linux desktop at hand. Nothing here has been built or run on Arch. See error.txt for what was and wasn't checked.

## Releasing

Bump the version in `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` and `packaging/arch/PKGBUILD` (the workflow refuses to run if they differ), then:

```bash
git tag v0.5.3 && git push --tags
```

`.github/workflows/release.yml` runs the full Linux build and tests, then makes a **draft** release with the `.deb`, `.rpm`, AppImage, Arch package and `latest.json`. Publish the draft when it looks right; the in-app update check reads `latest.json` from the newest published release of `mecharoy/ember-desktop-linux` (`DEFAULT_UPDATE_SOURCE` in `src/update/update.ts`), so the repo must be public for installed apps to see updates.
