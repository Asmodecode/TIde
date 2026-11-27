// Linux: TIde's .desktop file and icons for builds that don't install them (the portable .tar.gz,
// an AppImage, and `tauri dev`). On Wayland the desktop finds a window's icon only through a
// .desktop file named after its app ID ("TIde", see lib.rs), so without one KDE shows a generic
// "W" and GNOME a blank icon. The .deb and .rpm install /usr/share/applications/TIde.desktop, and
// then nothing is written here.

use std::fs;
use std::path::{Path, PathBuf};

/// The app ID GTK gives the window (glib::set_prgname in lib.rs), and so the .desktop file's name.
const APP_ID: &str = "TIde";
/// Marks a .desktop file TIde wrote itself, so it can keep it up to date (a moved binary).
const GENERATED: &str = "X-TIde-Generated=true";

const ICONS: [(u32, &[u8]); 5] = [
    (32, include_bytes!("../icons/32x32.png")),
    (64, include_bytes!("../icons/64x64.png")),
    (128, include_bytes!("../icons/128x128.png")),
    (256, include_bytes!("../icons/128x128@2x.png")),
    (512, include_bytes!("../icons/icon.png")),
];

/// Writes ~/.local/share/applications/TIde.desktop and TIde's icons when no package installed
/// them. Quietly does nothing it can't do: a missing icon is never worth failing to start.
pub fn ensure() {
    let Some(data_home) = data_home() else { return };
    let file = data_home.join("applications").join(format!("{APP_ID}.desktop"));
    // A package's own entry wins. One TIde wrote before the package was installed would hide it
    // (an entry in your home folder overrides the system's of the same name), so it goes, with its icons.
    if data_dirs().iter().any(|dir| {
        let path = dir.join("applications").join(format!("{APP_ID}.desktop"));
        path != file && path.is_file()
    }) {
        if fs::read_to_string(&file).is_ok_and(|t| t.contains(GENERATED)) {
            let _ = fs::remove_file(&file);
            for (size, _) in ICONS {
                let _ = fs::remove_file(data_home.join(format!("icons/hicolor/{size}x{size}/apps/{APP_ID}.png")));
            }
        }
        return;
    }
    if let Ok(existing) = fs::read_to_string(&file) {
        if !existing.contains(GENERATED) {
            return; // someone's own TIde.desktop: theirs to keep
        }
        // A release build's launcher stays: a dev build only needs one for its icon, and that does.
        if cfg!(debug_assertions) && !existing.contains("NoDisplay=true") {
            return;
        }
    }
    let Some(exe) = executable() else { return };
    for (size, bytes) in ICONS {
        let dir = data_home.join(format!("icons/hicolor/{size}x{size}/apps"));
        let path = dir.join(format!("{APP_ID}.png"));
        if fs::read(&path).ok().as_deref() != Some(bytes) {
            let _ = fs::create_dir_all(&dir).and_then(|_| fs::write(&path, bytes));
        }
    }
    let contents = entry(&exe, cfg!(debug_assertions));
    if fs::read_to_string(&file).ok().as_deref() != Some(contents.as_str()) {
        if let Some(dir) = file.parent() {
            let _ = fs::create_dir_all(dir).and_then(|_| fs::write(&file, contents));
        }
    }
}

/// The .desktop file. A development build's is hidden from the app menu: it's only there for the
/// window's icon, since the debug binary needs `tauri dev` running to show anything.
fn entry(exe: &Path, hidden: bool) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=TIde\n\
         GenericName=Calculator IDE\n\
         Comment=Write, build and run programs for TI calculators\n\
         Exec={} %F\n\
         Icon={APP_ID}\n\
         StartupWMClass={APP_ID}\n\
         Terminal=false\n\
         Categories=Development;IDE;Education;\n\
         MimeType=application/x-tideex;\n\
         {}{GENERATED}\n",
        quote_exec(&exe.to_string_lossy()),
        if hidden { "NoDisplay=true\n" } else { "" },
    )
}

/// A path as one argument of a .desktop Exec line: quoted, with ", `, $ and \ escaped, and % doubled.
fn quote_exec(path: &str) -> String {
    let mut out = String::from("\"");
    for c in path.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                out.push('\\');
                out.push(c);
            }
            '%' => out.push_str("%%"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// What the desktop should run: the AppImage itself (not its temporary mount), or this program.
fn executable() -> Option<PathBuf> {
    std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
}

/// $XDG_DATA_HOME, or ~/.local/share.
fn data_home() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
}

/// $XDG_DATA_DIRS, or /usr/local/share and /usr/share: where packages install .desktop files.
fn data_dirs() -> Vec<PathBuf> {
    let dirs = std::env::var("XDG_DATA_DIRS")
        .ok()
        .filter(|d| !d.trim().is_empty())
        .unwrap_or_else(|| "/usr/local/share:/usr/share".to_string());
    dirs.split(':').filter(|d| !d.is_empty()).map(PathBuf::from).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exec_paths_are_quoted_and_escaped() {
        assert_eq!(quote_exec("/opt/TIde/tide"), "\"/opt/TIde/tide\"");
        assert_eq!(quote_exec("/home/a b/100%/$x\"y"), "\"/home/a b/100%%/\\$x\\\"y\"");
    }

    #[test]
    fn the_entry_names_the_icon_and_hides_dev_builds() {
        let release = entry(Path::new("/opt/tide"), false);
        assert!(release.contains("Icon=TIde\n") && release.contains("StartupWMClass=TIde\n"));
        assert!(release.contains("Exec=\"/opt/tide\" %F\n") && !release.contains("NoDisplay"));
        assert!(release.ends_with(&format!("{GENERATED}\n")));
        assert!(entry(Path::new("/opt/tide"), true).contains("NoDisplay=true\n"));
    }
}
