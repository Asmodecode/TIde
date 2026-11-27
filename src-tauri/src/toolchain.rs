// The toolchains a project's build needs: whether they're installed, and installing the CE C/C++
// toolchain (CEdev, https://github.com/CE-Programming/toolchain), which has a release for every
// platform. TIde downloads it once into its data folder, as it does CEmu, and Settings → Toolchains
// → CE toolchain folder points there. The Ndless SDK and Luna have no ready-made downloads, so
// TIde only looks for them; the page that asks links to how to install them.
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::Manager;

const CEDEV_VERSION: &str = "v15.0";

#[derive(Serialize)]
pub struct ToolchainStatus {
    /** Whether the toolchain is there: its folder in Settings, or on PATH. */
    found: bool,
    /** Where it is: the toolchain's folder, or Luna's program. */
    path: Option<String>,
    /** Whether make is there too, for the toolchains whose builds run it. */
    make: bool,
}

/// A program's file name on this system: "make.exe" on Windows.
fn exe(name: &str) -> String {
    if cfg!(windows) { format!("{name}.exe") } else { name.to_string() }
}

/// A program in one of `dirs`, then on PATH.
fn which(name: &str, dirs: &[PathBuf]) -> Option<PathBuf> {
    let file = exe(name);
    let path = std::env::var_os("PATH");
    dirs.iter()
        .cloned()
        .chain(path.iter().flat_map(std::env::split_paths))
        .map(|dir| dir.join(&file))
        .find(|p| p.is_file())
}

/// The CE toolchain's own folder, from any of its programs: <CEDEV>/bin/convbin → <CEDEV>, when
/// that folder has the toolchain's makefile (meta/makefile.mk).
fn cedev_root(bin_file: &Path) -> Option<PathBuf> {
    let root = bin_file.parent()?.parent()?;
    root.join("meta/makefile.mk").is_file().then(|| root.to_path_buf())
}

/// Whether a project's toolchain is installed. `kind`: "ce" (the CE toolchain), "ndless" (the
/// Ndless SDK) or "luna". `home`: its setting, the folder (or for Luna, the command), if any.
#[tauri::command]
pub fn toolchain_status(kind: String, home: Option<String>) -> Result<ToolchainStatus, String> {
    let home = home.map(|h| h.trim().to_string()).filter(|h| !h.is_empty());
    let home_dir = home.as_deref().map(PathBuf::from);
    Ok(match kind.as_str() {
        "ce" => {
            let path = home_dir
                .clone()
                .filter(|h| h.join("meta/makefile.mk").is_file())
                .or_else(|| which("convbin", &[]).and_then(|p| cedev_root(&p)));
            // On Windows the toolchain has its own make.
            let bins: Vec<PathBuf> = path.iter().map(|p| p.join("bin")).collect();
            ToolchainStatus { found: path.is_some(), make: which("make", &bins).is_some(), path: path.map(display) }
        }
        "ndless" => {
            let bins: Vec<PathBuf> = home_dir
                .iter()
                .flat_map(|h| [h.join("bin"), h.join("ndless-sdk/bin")])
                .collect();
            let gcc = which("nspire-gcc", &bins);
            let path = gcc.as_deref().and_then(|g| g.parent()).map(|p| display(p.to_path_buf()));
            ToolchainStatus { found: gcc.is_some(), path, make: which("make", &bins).is_some() }
        }
        "luna" => {
            let command = home.unwrap_or_else(|| "luna".to_string());
            let found = if command.contains('/') || command.contains('\\') {
                Some(PathBuf::from(&command)).filter(|p| p.is_file())
            } else {
                which(&command, &[])
            };
            ToolchainStatus { found: found.is_some(), path: found.map(display), make: true }
        }
        other => return Err(format!("TIde doesn't know the toolchain \"{other}\".")),
    })
}

fn display(path: PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

/// The release file for this platform.
fn cedev_asset() -> Result<&'static str, String> {
    if cfg!(target_os = "windows") {
        Ok("CEdev-Windows.zip")
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok("CEdev-macOS-arm.dmg")
    } else if cfg!(target_os = "macos") {
        Ok("CEdev-macOS-intel.dmg")
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        Ok("CEdev-Linux.tar.gz")
    } else {
        Err("The CE toolchain has no download for this system. Build it from https://github.com/CE-Programming/toolchain".into())
    }
}

/// Quiet child processes: no console window flashes up on Windows.
fn command(program: &str) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

fn run(cmd: &mut Command, what: &str) -> Result<(), String> {
    let out = cmd.output().map_err(|e| format!("Could not run {what}: {e}"))?;
    if out.status.success() {
        return Ok(());
    }
    Err(format!("{what} failed: {}", String::from_utf8_lossy(&out.stderr).trim()))
}

/// The CE toolchain's folder anywhere under `dir`: the one with meta/makefile.mk.
fn find_cedev(dir: &Path, depth: u32) -> Option<PathBuf> {
    if dir.join("meta/makefile.mk").is_file() {
        return Some(dir.to_path_buf());
    }
    if depth == 0 {
        return None;
    }
    fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_dir()).find_map(|p| find_cedev(&p, depth - 1))
}

/// Downloads the CE toolchain's release for this platform into TIde's data folder
/// (toolchains/CEdev) and returns its folder, for Settings → CE toolchain folder.
#[tauri::command(async)]
pub fn toolchain_install_ce(app: tauri::AppHandle) -> Result<String, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?.join("toolchains");
    let target = base.join("CEdev");
    let name = cedev_asset()?;
    let work = base.join("download");
    let _ = fs::remove_dir_all(&work);
    fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let download = work.join(name);
    let url = format!("https://github.com/CE-Programming/toolchain/releases/download/{CEDEV_VERSION}/{name}");
    // curl ships with Windows 10+, macOS and Linux, and follows GitHub's redirect to the file.
    run(
        command("curl").args(["--location", "--fail", "--silent", "--show-error", "--output"]).arg(&download).arg(&url),
        "Downloading the CE toolchain",
    )?;
    let unpacked = work.join("unpacked");
    fs::create_dir_all(&unpacked).map_err(|e| e.to_string())?;
    if cfg!(target_os = "macos") {
        let mount = work.join("mount");
        run(
            command("hdiutil").args(["attach", "-nobrowse", "-readonly", "-mountpoint"]).arg(&mount).arg(&download),
            "Opening the CE toolchain's disk image",
        )?;
        let copied = find_cedev(&mount, 3)
            .ok_or_else(|| "The CE toolchain's disk image has no toolchain in it.".to_string())
            .and_then(|dir| run(command("cp").arg("-R").arg(&dir).arg(unpacked.join("CEdev")), "Copying the CE toolchain"));
        let _ = command("hdiutil").args(["detach", "-quiet"]).arg(&mount).output();
        copied?;
    } else {
        // tar unpacks the Linux .tar.gz, and on Windows (bsdtar, in Windows 10 and later) the .zip too.
        run(command("tar").arg("-xf").arg(&download).arg("-C").arg(&unpacked), "Unpacking the CE toolchain")?;
    }
    let found = find_cedev(&unpacked, 3).ok_or_else(|| "The CE toolchain's download has no toolchain in it.".to_string())?;
    let _ = fs::remove_dir_all(&target);
    fs::rename(&found, &target).map_err(|e| format!("Couldn't move the CE toolchain into place: {e}"))?;
    let _ = fs::remove_dir_all(&work);
    Ok(display(target))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_ce_toolchain_by_its_makefile() {
        let base = std::env::temp_dir().join(format!("tide-cedev-{}", std::process::id()));
        let root = base.join("unpacked/CEdev");
        fs::create_dir_all(root.join("meta")).unwrap();
        fs::create_dir_all(root.join("bin")).unwrap();
        fs::write(root.join("meta/makefile.mk"), "").unwrap();
        assert_eq!(find_cedev(&base, 3), Some(root.clone()));
        assert_eq!(cedev_root(&root.join("bin").join(exe("convbin"))), Some(root.clone()));
        assert_eq!(find_cedev(&base.join("unpacked/CEdev/bin"), 3), None);
        let status = toolchain_status("ce".into(), Some(display(root))).unwrap();
        assert!(status.found);
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn luna_can_be_a_path_or_a_command() {
        assert!(!toolchain_status("luna".into(), Some("/no/such/luna".into())).unwrap().found);
        assert!(toolchain_status("mystery".into(), None).is_err());
    }
}
