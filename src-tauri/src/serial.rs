// Serial ports for the calculator link in the desktop app (the web view has no Web Serial): TI's
// grey TI-Graph Link and other serial cables. src/serial.ts drives these, and src/dbus.ts speaks
// TI's link protocol over them.
use serde::Serialize;
use std::io::{ErrorKind, Read, Write};
use std::sync::Mutex;
use std::time::Duration;

static PORT: Mutex<Option<Box<dyn serialport::SerialPort>>> = Mutex::new(None);

#[derive(Serialize)]
pub struct PortInfo {
    path: String,
    /// What it is, where the system says: "USB Serial Port", "Prolific USB-to-Serial".
    description: String,
}

/// The serial ports on this computer.
#[tauri::command(async)]
pub fn serial_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports.into_iter().map(|p| {
        let description = match p.port_type {
            serialport::SerialPortType::UsbPort(u) => u.product.or(u.manufacturer).unwrap_or_else(|| "USB serial port".into()),
            serialport::SerialPortType::BluetoothPort => "Bluetooth".into(),
            serialport::SerialPortType::PciPort => "Serial port".into(),
            serialport::SerialPortType::Unknown => String::new(),
        };
        PortInfo { path: p.port_name, description }
    }).collect())
}

/// Opens a port, in place of any open before: 8 data bits, no parity, 1 stop bit, no flow control,
/// with DTR and RTS on, which power the grey TI-Graph Link.
#[tauri::command(async)]
pub fn serial_open(path: String, baud: u32) -> Result<(), String> {
    *PORT.lock().unwrap() = None;
    let mut port = serialport::new(&path, baud)
        .data_bits(serialport::DataBits::Eight)
        .parity(serialport::Parity::None)
        .stop_bits(serialport::StopBits::One)
        .flow_control(serialport::FlowControl::None)
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Couldn't open {path}: {e}"))?;
    port.write_data_terminal_ready(true).map_err(|e| e.to_string())?;
    port.write_request_to_send(true).map_err(|e| e.to_string())?;
    // The cable takes a moment to power up; anything already waiting is noise.
    std::thread::sleep(Duration::from_millis(150));
    let _ = port.clear(serialport::ClearBuffer::All);
    *PORT.lock().unwrap() = Some(port);
    Ok(())
}

#[tauri::command(async)]
pub fn serial_close() {
    *PORT.lock().unwrap() = None;
}

/// Writes the request's body.
#[tauri::command(async)]
pub fn serial_write(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Nothing to send.".into()) };
    let mut guard = PORT.lock().unwrap();
    let port = guard.as_mut().ok_or("The serial port isn't open.")?;
    port.write_all(bytes).and_then(|_| port.flush()).map_err(|e| e.to_string())
}

/// Reads up to `max` bytes, waiting at most `timeout` milliseconds for the first. Empty if none came.
#[tauri::command(async)]
pub fn serial_read(max: usize, timeout: u64) -> Result<tauri::ipc::Response, String> {
    let mut guard = PORT.lock().unwrap();
    let port = guard.as_mut().ok_or("The serial port isn't open.")?;
    port.set_timeout(Duration::from_millis(timeout.max(1))).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; max.clamp(1, 65536)];
    match port.read(&mut buf) {
        Ok(n) => { buf.truncate(n); Ok(tauri::ipc::Response::new(buf)) }
        Err(e) if e.kind() == ErrorKind::TimedOut => Ok(tauri::ipc::Response::new(Vec::new())),
        Err(e) => Err(e.to_string()),
    }
}
