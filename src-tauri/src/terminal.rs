// Opens a visible terminal that runs one command (Claude/Codex sign-in and the
// installers). Linux has no single "default terminal", so this tries $TERMINAL
// and then the common ones. Each terminal wants its own "run this" flag.

/// The words that come between the terminal's name and the command to run.
fn run_flag(term: &str) -> &'static [&'static str] {
    match term {
        "gnome-terminal" => &["--"],
        "wezterm" => &["start", "--"],
        "xfce4-terminal" | "terminator" => &["-x"],
        // These take the command as the rest of the line.
        "kitty" | "foot" => &[],
        _ => &["-e"],
    }
}

/// Full argument list for `term`, ending with the command.
fn terminal_args(term: &str, command: &[String]) -> Vec<String> {
    run_flag(term).iter().map(|s| s.to_string()).chain(command.iter().cloned()).collect()
}

/// $TERMINAL first (a user's own choice), then the usual suspects.
fn candidates(env_terminal: Option<&str>) -> Vec<String> {
    let mut list: Vec<String> = Vec::new();
    if let Some(t) = env_terminal.map(str::trim).filter(|t| !t.is_empty()) {
        list.push(t.to_string());
    }
    for t in [
        "x-terminal-emulator",
        "gnome-terminal",
        "konsole",
        "kitty",
        "alacritty",
        "foot",
        "wezterm",
        "xfce4-terminal",
        "tilix",
        "terminator",
        "lxterminal",
        "xterm",
    ] {
        if !list.iter().any(|x| x == t) {
            list.push(t.to_string());
        }
    }
    list
}

/// True once some terminal started. `command` is the program and its arguments.
pub fn open(command: &[String]) -> bool {
    let env = std::env::var("TERMINAL").ok();
    for term in candidates(env.as_deref()) {
        // "TERMINAL=/usr/bin/kitty" still needs the flag for "kitty".
        let name = std::path::Path::new(&term).file_name().and_then(|n| n.to_str()).unwrap_or(&term).to_string();
        let started = std::process::Command::new(&term)
            .args(terminal_args(&name, command))
            .stdin(std::process::Stdio::null())
            .spawn()
            .is_ok();
        if started {
            return true;
        }
    }
    false
}

/// `sh -c "<script>; exec $SHELL"`-style helper: keeps the window open after
/// the command ends so the user can read what it printed.
pub fn open_script(script: &str) -> bool {
    open(&["bash".to_string(), "-c".to_string(), format!("{script}; exec bash")])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cmd() -> Vec<String> {
        vec!["claude".to_string()]
    }

    #[test]
    fn each_terminal_gets_its_own_flag() {
        assert_eq!(terminal_args("gnome-terminal", &cmd()), ["--", "claude"]);
        assert_eq!(terminal_args("konsole", &cmd()), ["-e", "claude"]);
        assert_eq!(terminal_args("xfce4-terminal", &cmd()), ["-x", "claude"]);
        assert_eq!(terminal_args("wezterm", &cmd()), ["start", "--", "claude"]);
        assert_eq!(terminal_args("kitty", &cmd()), ["claude"]);
        assert_eq!(terminal_args("foot", &cmd()), ["claude"]);
        assert_eq!(terminal_args("some-unknown-term", &cmd()), ["-e", "claude"]);
    }

    #[test]
    fn env_terminal_goes_first_without_duplicates() {
        let list = candidates(Some("alacritty"));
        assert_eq!(list[0], "alacritty");
        assert_eq!(list.iter().filter(|t| *t == "alacritty").count(), 1);
        assert_eq!(candidates(Some("  ")).first().map(String::as_str), Some("x-terminal-emulator"));
        assert_eq!(candidates(None).first().map(String::as_str), Some("x-terminal-emulator"));
    }

    #[test]
    fn open_starts_the_first_terminal_on_the_path() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("ember-term-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let out = dir.join("out.txt");
        let fake = dir.join("konsole");
        std::fs::write(&fake, format!("#!/bin/sh\necho \"$@\" > {}\n", out.display())).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::env::set_var("PATH", &dir);
        std::env::remove_var("TERMINAL");

        assert!(open(&["claude".to_string()]));
        for _ in 0..40 {
            if out.exists() && std::fs::read_to_string(&out).map_or(false, |t| !t.is_empty()) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        assert_eq!(std::fs::read_to_string(&out).unwrap().trim(), "-e claude");

        std::fs::remove_file(&fake).unwrap();
        assert!(!open(&["claude".to_string()]), "no terminal installed must report failure");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
