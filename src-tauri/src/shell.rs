// Command lines run through the system shell (cmd on Windows, sh elsewhere), with their output
// streamed to the page as it comes. The Terminal and every .tide/tide.json command line (build,
// prerun, postrun, scripts) use this, so pipes, &&, redirects and variables work as in a terminal.
//
// Events: "shell://output" { id, text, err } for each piece of output, and "shell://exit" { id, code }
// when the command ends (code is null if it was stopped or couldn't report one).
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct Shells(Mutex<HashMap<u32, Running>>);

pub struct Running {
    child: Arc<Mutex<Child>>,
    stdin: Option<ChildStdin>,
}

#[derive(Clone, Serialize)]
struct Output {
    id: u32,
    text: String,
    err: bool,
}

#[derive(Clone, Serialize)]
struct Exit {
    id: u32,
    code: Option<i32>,
}

/// The command that runs `line` in the system shell.
fn shell_command(line: &str) -> Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let mut c = Command::new("cmd");
        // /S with the line in quotes passes it to cmd exactly as written.
        c.raw_arg(format!("/D /S /C \"{line}\""));
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        c
    }
    #[cfg(not(windows))]
    {
        use std::os::unix::process::CommandExt;
        let mut c = Command::new("/bin/sh");
        c.arg("-c").arg(line);
        c.process_group(0); // so Stop ends everything the line started
        c
    }
}

/// Splits off a trailing, unfinished UTF-8 sequence, so a character cut between two reads isn't garbled.
fn split_utf8(buf: &[u8]) -> usize {
    let len = buf.len();
    for back in 1..=3.min(len) {
        let b = buf[len - back];
        if b & 0xC0 == 0x80 {
            continue; // a continuation byte: keep looking for the start
        }
        let need = if b >= 0xF0 { 4 } else if b >= 0xE0 { 3 } else if b >= 0xC0 { 2 } else { 1 };
        return if need > back { len - back } else { len };
    }
    len
}

fn pump(app: AppHandle, id: u32, mut from: impl Read + Send + 'static, err: bool) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = vec![0u8; 8192];
        let mut held: Vec<u8> = Vec::new();
        loop {
            let n = match from.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => n,
            };
            held.extend_from_slice(&buf[..n]);
            let cut = split_utf8(&held);
            if cut > 0 {
                let text = String::from_utf8_lossy(&held[..cut]).into_owned();
                held.drain(..cut);
                let _ = app.emit("shell://output", Output { id, text, err });
            }
        }
        if !held.is_empty() {
            let _ = app.emit("shell://output", Output { id, text: String::from_utf8_lossy(&held).into_owned(), err });
        }
    })
}

/// Starts `line` in the shell, in `dir`. Output and the exit come as events with this `id`.
#[tauri::command]
pub fn shell_run(app: AppHandle, shells: State<Shells>, id: u32, dir: String, line: String) -> Result<(), String> {
    let mut cmd = shell_command(&line);
    cmd.current_dir(&dir).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    // Tools that color their output when they see a terminal keep it plain, but still show progress.
    cmd.env("TERM", "dumb").env("CLICOLOR", "0");
    let mut child = cmd.spawn().map_err(|e| format!("Couldn't start the shell: {e}"))?;
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let stdin = child.stdin.take();
    let child = Arc::new(Mutex::new(child));
    shells.0.lock().unwrap().insert(id, Running { child: child.clone(), stdin });
    let out = pump(app.clone(), id, stdout, false);
    let err = pump(app.clone(), id, stderr, true);
    std::thread::spawn(move || {
        let _ = out.join();
        let _ = err.join();
        // Output is done; wait for the process itself, polling so Stop can still reach it.
        let code = loop {
            match child.lock().unwrap().try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) => {}
                Err(_) => break None,
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        };
        let _ = app.emit("shell://exit", Exit { id, code });
    });
    Ok(())
}

/// Forgets a finished command (its exit event has arrived).
#[tauri::command]
pub fn shell_forget(shells: State<Shells>, id: u32) {
    shells.0.lock().unwrap().remove(&id);
}

/// Sends text to a running command's input, such as an answer to a prompt.
#[tauri::command]
pub fn shell_input(shells: State<Shells>, id: u32, text: String) -> Result<(), String> {
    let mut all = shells.0.lock().unwrap();
    let running = all.get_mut(&id).ok_or("That command has finished.")?;
    let stdin = running.stdin.as_mut().ok_or("That command doesn't take input.")?;
    stdin.write_all(text.as_bytes()).and_then(|_| stdin.flush()).map_err(|e| e.to_string())
}

/// Stops a running command and everything it started.
#[tauri::command]
pub fn shell_stop(shells: State<Shells>, id: u32) -> Result<(), String> {
    let all = shells.0.lock().unwrap();
    let Some(running) = all.get(&id) else { return Ok(()) };
    let mut child = running.child.lock().unwrap();
    let pid = child.id();
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // cmd's children keep running if only cmd is killed: end the whole tree.
        let _ = Command::new("taskkill").args(["/T", "/F", "/PID", &pid.to_string()]).creation_flags(0x0800_0000).output();
    }
    #[cfg(not(windows))]
    {
        let _ = Command::new("kill").args(["-TERM", &format!("-{pid}")]).output();
    }
    let _ = child.kill();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_utf8_only_at_character_boundaries() {
        let text = "aé€😀".as_bytes(); // 1, 2, 3 and 4 bytes
        assert_eq!(split_utf8(text), text.len());
        assert_eq!(split_utf8(&text[..text.len() - 1]), text.len() - 4); // half an emoji held back
        assert_eq!(split_utf8(&text[..2]), 1); // half an é held back
        assert_eq!(split_utf8(b"plain"), 5);
    }

    #[test]
    fn the_shell_runs_pipes_and_and() {
        #[cfg(windows)]
        let line = "echo one && echo two | findstr two";
        #[cfg(not(windows))]
        let line = "echo one && echo two | grep two";
        let out = shell_command(line).output().unwrap();
        let text = String::from_utf8_lossy(&out.stdout);
        assert!(out.status.success());
        assert!(text.contains("one") && text.contains("two"), "{text}");
    }
}
