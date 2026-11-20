// The Terminal: an interactive shell on a pseudo-terminal (ConPTY on Windows), drawn by xterm.js in
// the page (src/terminal.ts). Unlike shell.rs's one-command runs, the shell keeps going, so cd,
// history, line editing, colors and full-screen programs all work as in any terminal.
//
// Events: "pty://output" { id, data } as the shell writes, and "pty://exit" { id, code } when it ends.
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

struct Pty {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct Ptys(Mutex<HashMap<u32, Pty>>);

#[derive(Clone, Serialize)]
struct Output {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: u32,
    code: Option<u32>,
}

/// Whether a program is on the PATH.
#[cfg(windows)]
fn on_path(exe: &str) -> bool {
    std::env::var_os("PATH").is_some_and(|path| std::env::split_paths(&path).any(|dir| dir.join(exe).is_file()))
}

/// The user's shell: PowerShell 7 or Windows PowerShell on Windows, $SHELL elsewhere.
fn default_shell() -> CommandBuilder {
    #[cfg(windows)]
    {
        let mut cmd = CommandBuilder::new(if on_path("pwsh.exe") { "pwsh.exe" } else { "powershell.exe" });
        cmd.arg("-NoLogo");
        cmd
    }
    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").ok().filter(|s| std::path::Path::new(s).exists()).unwrap_or_else(|| "/bin/sh".into());
        let mut cmd = CommandBuilder::new(shell);
        cmd.arg("-l"); // a login shell, so its PATH is the user's own (as Terminal.app starts it)
        cmd
    }
}

const fn size(cols: u16, rows: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

/// Starts a shell in `dir` on a terminal `cols` by `rows`. Its output and end come as events with this `id`.
#[tauri::command]
pub fn pty_open(app: AppHandle, ptys: State<Ptys>, id: u32, dir: String, cols: u16, rows: u16) -> Result<(), String> {
    let pair = native_pty_system().openpty(size(cols.max(2), rows.max(1))).map_err(|e| e.to_string())?;
    let mut cmd = default_shell();
    if std::path::Path::new(&dir).is_dir() {
        cmd.cwd(&dir);
    }
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERM_PROGRAM", "TIde");
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("Couldn't start the shell: {e}"))?;
    drop(pair.slave); // the shell has it; the output ends when the shell does
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    ptys.0.lock().unwrap().insert(id, Pty { master: pair.master, writer, child });

    std::thread::spawn(move || {
        let mut buf = vec![0u8; 16384];
        let mut held: Vec<u8> = Vec::new();
        loop {
            let n = match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            held.extend_from_slice(&buf[..n]);
            let cut = crate::shell::split_utf8(&held);
            if cut > 0 {
                let data = String::from_utf8_lossy(&held[..cut]).into_owned();
                held.drain(..cut);
                let _ = app.emit("pty://output", Output { id, data });
            }
        }
        let code = {
            use tauri::Manager;
            let ptys = app.state::<Ptys>();
            let mut all = ptys.0.lock().unwrap();
            let code = all.get_mut(&id).and_then(|p| p.child.try_wait().ok().flatten()).map(|s| s.exit_code());
            all.remove(&id);
            code
        };
        let _ = app.emit("pty://exit", Exit { id, code });
    });
    Ok(())
}

/// Types into the shell: keys, pasted text, and the replies xterm.js makes to the shell's queries.
#[tauri::command]
pub fn pty_write(ptys: State<Ptys>, id: u32, data: String) -> Result<(), String> {
    let mut all = ptys.0.lock().unwrap();
    let pty = all.get_mut(&id).ok_or("The terminal has closed.")?;
    pty.writer.write_all(data.as_bytes()).and_then(|_| pty.writer.flush()).map_err(|e| e.to_string())
}

/// Tells the shell the terminal's new size, so full-screen programs and line wrapping fit it.
#[tauri::command]
pub fn pty_resize(ptys: State<Ptys>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    let all = ptys.0.lock().unwrap();
    let Some(pty) = all.get(&id) else { return Ok(()) };
    pty.master.resize(size(cols.max(2), rows.max(1))).map_err(|e| e.to_string())
}

/// Ends the shell and whatever it's running.
#[tauri::command]
pub fn pty_kill(ptys: State<Ptys>, id: u32) {
    if let Some(pty) = ptys.0.lock().unwrap().get_mut(&id) {
        let _ = pty.child.kill();
    }
}
