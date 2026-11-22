// USB for the calculator link in the desktop app. The link itself is WebTILP's library (TILP's
// libraries compiled to WebAssembly, in public/webtilp), which talks to calculators through the
// browser's WebUSB. The desktop app's web view has no WebUSB, so src/usb-shim.ts gives the page one,
// made of these commands: each is one WebUSB operation on a device, through nusb.
//
// Only TI's devices are listed: the SilverLink cable and the calculators with a USB port.
use nusb::transfer::{Bulk, ControlIn, ControlOut, ControlType, In, Out, Recipient};
use nusb::MaybeFuture;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const TI: u16 = 0x0451;

struct Open {
    id: String,
    device: nusb::Device,
    interfaces: HashMap<u8, nusb::Interface>,
    ins: HashMap<u8, Arc<Mutex<nusb::Endpoint<Bulk, In>>>>,
    outs: HashMap<u8, Arc<Mutex<nusb::Endpoint<Bulk, Out>>>>,
}

static OPEN: Mutex<Option<Open>> = Mutex::new(None);

fn with_open<T>(f: impl FnOnce(&mut Open) -> Result<T, String>) -> Result<T, String> {
    let mut guard = OPEN.lock().unwrap();
    f(guard.as_mut().ok_or("The device isn't open.")?)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkDevice {
    id: String,
    vendor_id: u16,
    product_id: u16,
    product_name: Option<String>,
    manufacturer_name: Option<String>,
    serial_number: Option<String>,
}

fn ti_devices() -> Result<Vec<nusb::DeviceInfo>, String> {
    Ok(nusb::list_devices().wait().map_err(|e| e.to_string())?.filter(|d| d.vendor_id() == TI).collect())
}

/// TI's USB devices plugged in.
#[tauri::command(async)]
pub fn link_devices() -> Result<Vec<LinkDevice>, String> {
    Ok(ti_devices()?.iter().map(|d| LinkDevice {
        id: format!("{:?}", d.id()),
        vendor_id: d.vendor_id(),
        product_id: d.product_id(),
        product_name: d.product_string().map(str::to_owned),
        manufacturer_name: d.manufacturer_string().map(str::to_owned),
        serial_number: d.serial_number().map(str::to_owned),
    }).collect())
}

#[derive(Serialize)]
pub struct Descriptors {
    device: Vec<u8>,
    configurations: Vec<Vec<u8>>,
    active: u8,
}

/// Opens a device, in place of any open before, and returns its descriptors.
#[tauri::command(async)]
pub fn link_open(id: String) -> Result<Descriptors, String> {
    *OPEN.lock().unwrap() = None;
    let info = ti_devices()?.into_iter().find(|d| format!("{:?}", d.id()) == id).ok_or("The device was unplugged.")?;
    let device = info.open().wait().map_err(|e| format!("Couldn't open the device: {e}"))?;
    let descriptors = Descriptors {
        device: device.device_descriptor().as_bytes().to_vec(),
        configurations: device.configurations().map(|c| c.as_bytes().to_vec()).collect(),
        active: device.active_configuration().map(|c| c.configuration_value()).unwrap_or(0),
    };
    *OPEN.lock().unwrap() = Some(Open { id, device, interfaces: HashMap::new(), ins: HashMap::new(), outs: HashMap::new() });
    Ok(descriptors)
}

#[tauri::command(async)]
pub fn link_close() {
    *OPEN.lock().unwrap() = None;
}

/// Whether the device `id` is the one open.
#[tauri::command(async)]
pub fn link_is_open(id: String) -> bool {
    OPEN.lock().unwrap().as_ref().is_some_and(|o| o.id == id)
}

#[tauri::command(async)]
pub fn link_set_configuration(value: u8) -> Result<(), String> {
    with_open(|o| {
        if o.device.active_configuration().map(|c| c.configuration_value()).ok() == Some(value) {
            return Ok(());
        }
        o.device.set_configuration(value).wait().map_err(|e| e.to_string())
    })
}

#[tauri::command(async)]
pub fn link_claim(interface: u8) -> Result<(), String> {
    with_open(|o| {
        if o.interfaces.contains_key(&interface) {
            return Ok(());
        }
        let claimed = o.device.claim_interface(interface).wait().map_err(|e| {
            if cfg!(windows) {
                format!("Windows won't let TIde use it ({e}). It needs the WinUSB driver: install it for the calculator or cable with Zadig (zadig.akeo.ie), as for TILP, then plug it in again.")
            } else {
                format!("Couldn't use it ({e}). Is another program (TI Connect, TILP) using it?")
            }
        })?;
        o.interfaces.insert(interface, claimed);
        Ok(())
    })
}

#[tauri::command(async)]
pub fn link_release(interface: u8) -> Result<(), String> {
    with_open(|o| {
        o.interfaces.remove(&interface);
        Ok(())
    })
}

#[tauri::command(async)]
pub fn link_alternate(interface: u8, alternate: u8) -> Result<(), String> {
    with_open(|o| {
        let iface = o.interfaces.get(&interface).ok_or("That interface isn't claimed.")?;
        iface.set_alt_setting(alternate).wait().map_err(|e| e.to_string())
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    request_type: String,
    recipient: String,
    request: u8,
    value: u16,
    index: u16,
}

fn setup_kind(s: &Setup) -> (ControlType, Recipient) {
    let kind = match s.request_type.as_str() {
        "class" => ControlType::Class,
        "vendor" => ControlType::Vendor,
        _ => ControlType::Standard,
    };
    let recipient = match s.recipient.as_str() {
        "interface" => Recipient::Interface,
        "endpoint" => Recipient::Endpoint,
        "other" => Recipient::Other,
        _ => Recipient::Device,
    };
    (kind, recipient)
}

/// Control transfers go through a claimed interface (Windows allows no other way).
fn control_interface(o: &Open) -> Result<&nusb::Interface, String> {
    o.interfaces.values().next().ok_or_else(|| "Claim an interface before a control transfer.".into())
}

#[tauri::command(async)]
pub fn link_control_in(setup: Setup, length: u16) -> Result<tauri::ipc::Response, String> {
    let (control_type, recipient) = setup_kind(&setup);
    with_open(|o| {
        let data = control_interface(o)?
            .control_in(ControlIn { control_type, recipient, request: setup.request, value: setup.value, index: setup.index, length }, Duration::from_secs(5))
            .wait().map_err(|e| e.to_string())?;
        Ok(tauri::ipc::Response::new(data))
    })
}

#[tauri::command(async)]
pub fn link_control_out(setup: Setup, data: Vec<u8>) -> Result<usize, String> {
    let (control_type, recipient) = setup_kind(&setup);
    with_open(|o| {
        control_interface(o)?
            .control_out(ControlOut { control_type, recipient, request: setup.request, value: setup.value, index: setup.index, data: &data }, Duration::from_secs(5))
            .wait().map_err(|e| e.to_string())?;
        Ok(data.len())
    })
}

/// The claimed interface that has endpoint `address`.
fn owner(o: &Open, address: u8) -> Result<&nusb::Interface, String> {
    o.interfaces.values()
        .find(|i| i.descriptor().is_some_and(|d| d.endpoints().any(|e| e.address() == address)))
        .ok_or_else(|| format!("No claimed interface has endpoint {address:#04x}."))
}

fn endpoint_in(number: u8) -> Result<Arc<Mutex<nusb::Endpoint<Bulk, In>>>, String> {
    with_open(|o| {
        if let Some(ep) = o.ins.get(&number) {
            return Ok(ep.clone());
        }
        let ep = Arc::new(Mutex::new(owner(o, 0x80 | number)?.endpoint::<Bulk, In>(0x80 | number).map_err(|e| e.to_string())?));
        o.ins.insert(number, ep.clone());
        Ok(ep)
    })
}

fn endpoint_out(number: u8) -> Result<Arc<Mutex<nusb::Endpoint<Bulk, Out>>>, String> {
    with_open(|o| {
        if let Some(ep) = o.outs.get(&number) {
            return Ok(ep.clone());
        }
        let ep = Arc::new(Mutex::new(owner(o, number)?.endpoint::<Bulk, Out>(number).map_err(|e| e.to_string())?));
        o.outs.insert(number, ep.clone());
        Ok(ep)
    })
}

/// A bulk OUT transfer of the request's body, on the endpoint in the `x-tide-endpoint` header.
#[tauri::command(async)]
pub fn link_transfer_out(request: tauri::ipc::Request<'_>) -> Result<usize, String> {
    let number: u8 = request.headers().get("x-tide-endpoint").and_then(|v| v.to_str().ok()).and_then(|v| v.parse().ok()).ok_or("No endpoint.")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("Nothing to send.".into()) };
    let ep = endpoint_out(number)?;
    let mut ep = ep.lock().unwrap();
    ep.submit(bytes.clone().into());
    match ep.wait_next_complete(Duration::from_secs(10)) {
        Some(done) => done.status.map(|()| bytes.len()).map_err(|e| e.to_string()),
        None => {
            ep.cancel_all();
            while ep.wait_next_complete(Duration::from_millis(200)).is_some() {}
            Err("timeout".into())
        }
    }
}

/// A bulk IN transfer of up to `length` bytes, waiting at most `timeout` milliseconds. The first byte
/// of the result says what happened: 1 data (the rest), 0 nothing yet. A transfer that's still
/// waiting stays queued, so nothing that arrives later is lost: the next call gets it.
#[tauri::command(async)]
pub fn link_transfer_in(endpoint: u8, length: usize, timeout: u64) -> Result<tauri::ipc::Response, String> {
    let ep = endpoint_in(endpoint)?;
    let mut ep = ep.lock().unwrap();
    if ep.pending() == 0 {
        let packet = ep.max_packet_size().max(1);
        let buffer = ep.allocate(length.div_ceil(packet).max(1) * packet);
        ep.submit(buffer);
    }
    match ep.wait_next_complete(Duration::from_millis(timeout)) {
        Some(done) => {
            done.status.map_err(|e| e.to_string())?;
            let mut out = Vec::with_capacity(done.buffer.len() + 1);
            out.push(1);
            out.extend_from_slice(&done.buffer[..done.buffer.len().min(length)]);
            Ok(tauri::ipc::Response::new(out))
        }
        None => Ok(tauri::ipc::Response::new(vec![0])),
    }
}

#[tauri::command(async)]
pub fn link_clear_halt(endpoint: u8, inward: bool) -> Result<(), String> {
    if inward {
        let ep = endpoint_in(endpoint)?;
        let mut ep = ep.lock().unwrap();
        ep.cancel_all();
        while ep.wait_next_complete(Duration::from_millis(100)).is_some() {}
        ep.clear_halt().wait().map_err(|e| e.to_string())
    } else {
        let ep = endpoint_out(endpoint)?;
        let mut ep = ep.lock().unwrap();
        ep.clear_halt().wait().map_err(|e| e.to_string())
    }
}

#[tauri::command(async)]
pub fn link_reset() -> Result<(), String> {
    // Windows can't reset a device; there it's a no-op, as the link only uses it to recover.
    if cfg!(windows) {
        return Ok(());
    }
    with_open(|o| o.device.reset().wait().map_err(|e| e.to_string()))
}

/// A string descriptor (the product's name and so on), for the page's descriptor requests.
#[tauri::command(async)]
pub fn link_string(index: u8, language: u16) -> Result<tauri::ipc::Response, String> {
    let index = std::num::NonZeroU8::new(index).ok_or("No string.")?;
    with_open(|o| {
        let bytes = o.device.get_descriptor(3, index.get(), language, Duration::from_secs(2)).wait().map_err(|e| e.to_string())?;
        Ok(tauri::ipc::Response::new(bytes))
    })
}
