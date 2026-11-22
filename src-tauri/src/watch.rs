// Watches the open folder, so the Explorer shows files as they appear, change and go, whatever
// made them: a build, the terminal, another program. Changes are batched for a moment, then sent
// as "folder://changed" with the folders they happened in. Inside .git and node_modules is left
// out: git writes there whenever it runs, which would only cause refresh after refresh.
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct FolderWatch(Mutex<Option<RecommendedWatcher>>);

#[derive(Clone, Serialize)]
struct Changed {
    dirs: Vec<String>,
}

fn ignored(path: &Path) -> bool {
    path.components().any(|c| matches!(c.as_os_str().to_str(), Some(".git" | "node_modules")))
}

/// The folders a change happened in: each path's parent, so the folder listing it gets re-read.
fn collect(event: notify::Result<Event>, dirs: &mut BTreeSet<String>) {
    let Ok(event) = event else { return };
    if matches!(event.kind, EventKind::Access(_)) {
        return;
    }
    for path in event.paths.iter().filter(|p| !ignored(p)) {
        if let Some(parent) = path.parent() {
            dirs.insert(parent.to_string_lossy().into_owned());
        }
    }
}

/// Watches `path` and everything in it, replacing the folder watched before. None stops watching.
#[tauri::command]
pub fn watch_folder(app: AppHandle, watch: State<FolderWatch>, path: Option<String>) -> Result<(), String> {
    let mut slot = watch.0.lock().unwrap();
    *slot = None; // dropping the old watcher ends its thread
    let Some(path) = path else { return Ok(()) };
    let (tx, rx) = std::sync::mpsc::channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(tx).map_err(|e| format!("Couldn't watch {path}: {e}"))?;
    watcher.watch(Path::new(&path), RecursiveMode::Recursive).map_err(|e| format!("Couldn't watch {path}: {e}"))?;
    *slot = Some(watcher);
    std::thread::spawn(move || {
        // The channel closes when the watcher is dropped, which ends this loop.
        while let Ok(first) = rx.recv() {
            let mut dirs = BTreeSet::new();
            collect(first, &mut dirs);
            let until = Instant::now() + Duration::from_millis(150);
            while let Ok(more) = rx.recv_timeout(until.saturating_duration_since(Instant::now())) {
                collect(more, &mut dirs);
            }
            if !dirs.is_empty() {
                let _ = app.emit("folder://changed", Changed { dirs: dirs.into_iter().collect() });
            }
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn leaves_out_git_and_node_modules() {
        assert!(ignored(Path::new("/p/.git/index")));
        assert!(ignored(Path::new("/p/node_modules/x/y.js")));
        assert!(!ignored(Path::new("/p/src/main.c")));
        assert!(!ignored(Path::new("/p/.gitignore")));
    }
}
