// Update channels: Stable reads the newest tagged release's latest.json, Nightly the nightly.json
// that every build of main puts on the rolling "latest" release (see .github/workflows/build.yml).
// The updater plugin's own check() always reads tauri.conf.json's endpoint, so this checks the
// chosen channel's instead and hands the page the same update the plugin would: its resource id
// and details, which the plugin's JavaScript Update downloads and installs as usual.
use serde::Serialize;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

const STABLE: &str = "https://github.com/XSamuraiCoder/TIde/releases/latest/download/latest.json";
const NIGHTLY: &str = "https://github.com/XSamuraiCoder/TIde/releases/download/latest/nightly.json";

/// The update file a channel reads.
fn endpoint(channel: &str) -> &'static str {
    if channel == "nightly" {
        NIGHTLY
    } else {
        STABLE
    }
}

/// What the page needs to make the plugin's Update: the same fields as the plugin's check() returns.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateFound {
    rid: tauri::ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

/// Checks a channel ("stable" or "nightly") for a newer TIde. None when this one is the newest.
#[tauri::command]
pub async fn update_check(
    webview: tauri::Webview,
    channel: String,
) -> Result<Option<UpdateFound>, String> {
    let url = endpoint(&channel).parse().map_err(|e| format!("{e}"))?;
    let updater = webview
        .updater_builder()
        .endpoints(vec![url])
        .map_err(|e| e.to_string())?
        .build()
        .map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    Ok(Some(UpdateFound {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date: update.date.map(|d| d.to_string()),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: webview.resources_table().add(update),
    }))
}

/// Linux's fallback when the updater couldn't install its update: the updater replaces an AppImage
/// and installs a .deb or .rpm through pkexec, and nothing else (a converted package, a copy in a
/// folder only root can write, an unpacked .tar.gz). This fetches the release's .tar.gz instead,
/// the manifest's "linux-<arch>-tar" entry, through the same updater so its signature is checked,
/// and puts the tide binary inside it over the running one. Returns the version installed.
#[tauri::command]
pub async fn update_install_tar(webview: tauri::Webview, channel: String) -> Result<String, String> {
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (webview, channel);
        Err("The .tar.gz update is for Linux only.".into())
    }
    #[cfg(target_os = "linux")]
    {
        let url = endpoint(&channel).parse().map_err(|e| format!("{e}"))?;
        let updater = webview
            .updater_builder()
            .endpoints(vec![url])
            .map_err(|e| e.to_string())?
            .target(format!("linux-{}-tar", std::env::consts::ARCH))
            .build()
            .map_err(|e| e.to_string())?;
        let update = updater
            .check()
            .await
            .map_err(|e| e.to_string())?
            .ok_or("There's no newer TIde to install.")?;
        let archive = update.download(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
        let version = update.version.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            replace_binary(&exe, &binary_from_tar_gz(&archive)?)
        })
        .await
        .map_err(|e| e.to_string())??;
        Ok(version)
    }
}

/// The tide binary in a release's .tar.gz.
#[cfg(target_os = "linux")]
fn binary_from_tar_gz(archive: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(archive));
    for entry in tar.entries().map_err(|e| format!("Couldn't read the .tar.gz: {e}"))? {
        let mut entry = entry.map_err(|e| format!("Couldn't read the .tar.gz: {e}"))?;
        let is_tide = entry.path().is_ok_and(|p| p.file_name().is_some_and(|n| n == "tide"));
        if is_tide && entry.header().entry_type().is_file() {
            let mut binary = Vec::new();
            entry.read_to_end(&mut binary).map_err(|e| format!("Couldn't read the .tar.gz: {e}"))?;
            if !binary.starts_with(b"\x7fELF") {
                return Err("The .tar.gz's tide isn't a Linux program.".into());
            }
            return Ok(binary);
        }
    }
    Err("The .tar.gz has no tide program in it.".into())
}

/// Puts a new binary where the running one is. Written beside it and renamed over it, so the
/// running program keeps its old file and a failure leaves it as it was; a folder only root can
/// write (/usr/bin) goes through pkexec, which asks for the password.
#[cfg(target_os = "linux")]
fn replace_binary(exe: &std::path::Path, binary: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let dir = exe.parent().ok_or("TIde's folder couldn't be found.")?;
    let write = |path: &std::path::Path| -> std::io::Result<()> {
        std::fs::write(path, binary)?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755))
    };
    let beside = dir.join(format!(".tide-update-{}", std::process::id()));
    match write(&beside).and_then(|()| std::fs::rename(&beside, exe)) {
        Ok(()) => return Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => {
            let _ = std::fs::remove_file(&beside);
        }
        Err(e) => {
            let _ = std::fs::remove_file(&beside);
            return Err(format!("Couldn't replace {}: {e}", exe.display()));
        }
    }
    // install(1) unlinks a busy file and writes a new one, as the rename above does.
    let staged = std::env::temp_dir().join(format!("tide-update-{}", std::process::id()));
    write(&staged).map_err(|e| e.to_string())?;
    let status = std::process::Command::new("pkexec")
        .args(["install", "-m", "755"])
        .arg(&staged)
        .arg(exe)
        .status();
    let _ = std::fs::remove_file(&staged);
    match status {
        Ok(s) if s.success() => Ok(()),
        Ok(_) => Err(format!("Replacing {} needs your password, and wasn't allowed.", exe.display())),
        Err(e) => Err(format!("{} is in a folder only root can change, and pkexec couldn't run: {e}", exe.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_channel_reads_its_own_update_file() {
        assert!(endpoint("stable").ends_with("/releases/latest/download/latest.json"));
        assert!(endpoint("nightly").ends_with("/releases/download/latest/nightly.json"));
        // Anything else is Stable: an old or bad setting never moves anyone to nightlies.
        assert_eq!(endpoint("beta"), STABLE);
    }

    #[cfg(target_os = "linux")]
    fn tar_gz(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut tar = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        for (name, data) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(data.len() as u64);
            header.set_mode(0o755);
            header.set_cksum();
            tar.append_data(&mut header, name, *data).unwrap();
        }
        tar.into_inner().unwrap().finish().unwrap()
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_tar_gz_gives_its_tide_binary() {
        let elf: &[u8] = b"\x7fELF the new tide";
        let archive = tar_gz(&[("TIde/README.md", b"hello"), ("TIde/tide", elf)]);
        assert_eq!(binary_from_tar_gz(&archive).unwrap(), elf);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_tar_gz_without_a_linux_tide_is_refused() {
        assert!(binary_from_tar_gz(&tar_gz(&[("TIde/README.md", b"hello")])).is_err());
        assert!(binary_from_tar_gz(&tar_gz(&[("tide", b"#!/bin/sh\necho hi")])).is_err());
        assert!(binary_from_tar_gz(b"not a tar.gz").is_err());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn the_new_binary_replaces_the_old_one_in_a_writable_folder() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("tide-replace-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let exe = dir.join("tide");
        std::fs::write(&exe, b"\x7fELF old").unwrap();
        // A process still holding the old file keeps reading the old one, as a running TIde does.
        let held = std::fs::File::open(&exe).unwrap();
        replace_binary(&exe, b"\x7fELF new").unwrap();
        assert_eq!(std::fs::read(&exe).unwrap(), b"\x7fELF new");
        assert_eq!(std::fs::metadata(&exe).unwrap().permissions().mode() & 0o777, 0o755);
        let mut old = Vec::new();
        std::io::Read::read_to_end(&mut &held, &mut old).unwrap();
        assert_eq!(old, b"\x7fELF old");
        // Nothing is left beside it.
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
