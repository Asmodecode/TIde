// Serial ports in the desktop app, whose web view has no Web Serial: src/serial-shim.ts gives the
// page a navigator.serial made of these commands (with TIde's own port chooser), so the calculator
// link (src/serial.ts, src/dbus.ts) uses Web Serial the same way in the app and in a browser.
use serde::{Deserialize, Serialize};
use std::io::{ErrorKind, Read, Write};
use std::sync::Mutex;
use std::time::Duration;

static PORT: Mutex<Option<Box<dyn serialport::SerialPort>>> = Mutex::new(None);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PortInfo {
    path: String,
    /// What it is, where the system says: "USB Serial Port", "Prolific USB-to-Serial".
    description: String,
    /// A USB adapter's IDs, as Web Serial's getInfo() gives them.
    usb_vendor_id: Option<u16>,
    usb_product_id: Option<u16>,
    serial_number: Option<String>,
}

/// The serial ports on this computer.
#[tauri::command(async)]
pub fn serial_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports.into_iter().map(|p| match p.port_type {
        serialport::SerialPortType::UsbPort(u) => PortInfo {
            path: p.port_name,
            description: u.product.clone().or(u.manufacturer.clone()).unwrap_or_else(|| "USB serial port".into()),
            usb_vendor_id: Some(u.vid),
            usb_product_id: Some(u.pid),
            serial_number: u.serial_number,
        },
        other => PortInfo {
            path: p.port_name,
            description: match other {
                serialport::SerialPortType::BluetoothPort => "Bluetooth".into(),
                serialport::SerialPortType::PciPort => "Serial port".into(),
                _ => String::new(),
            },
            usb_vendor_id: None,
            usb_product_id: None,
            serial_number: None,
        },
    }).collect())
}

/// Web Serial's open() options.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenOptions {
    baud_rate: u32,
    data_bits: Option<u8>,
    stop_bits: Option<u8>,
    parity: Option<String>,
    flow_control: Option<String>,
}

/// Opens a port, in place of any open before, as Web Serial's open() would, with DTR and RTS on
/// (as browsers turn them on).
#[tauri::command(async)]
pub fn serial_open(path: String, options: OpenOptions) -> Result<(), String> {
    *PORT.lock().unwrap() = None;
    let mut port = serialport::new(&path, options.baud_rate)
        .data_bits(if options.data_bits == Some(7) { serialport::DataBits::Seven } else { serialport::DataBits::Eight })
        .stop_bits(if options.stop_bits == Some(2) { serialport::StopBits::Two } else { serialport::StopBits::One })
        .parity(match options.parity.as_deref() {
            Some("even") => serialport::Parity::Even,
            Some("odd") => serialport::Parity::Odd,
            _ => serialport::Parity::None,
        })
        .flow_control(if options.flow_control.as_deref() == Some("hardware") { serialport::FlowControl::Hardware } else { serialport::FlowControl::None })
        .timeout(Duration::from_millis(100))
        .open()
        .map_err(|e| format!("Couldn't open {path}: {e}"))?;
    port.write_data_terminal_ready(true).map_err(|e| e.to_string())?;
    port.write_request_to_send(true).map_err(|e| e.to_string())?;
    *PORT.lock().unwrap() = Some(port);
    Ok(())
}

/// Web Serial's setSignals(): DTR and RTS, each left as it is when not given.
#[tauri::command(async)]
pub fn serial_signals(dtr: Option<bool>, rts: Option<bool>) -> Result<(), String> {
    let mut guard = PORT.lock().unwrap();
    let port = guard.as_mut().ok_or("The serial port isn't open.")?;
    if let Some(on) = dtr {
        port.write_data_terminal_ready(on).map_err(|e| e.to_string())?;
    }
    if let Some(on) = rts {
        port.write_request_to_send(on).map_err(|e| e.to_string())?;
    }
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
