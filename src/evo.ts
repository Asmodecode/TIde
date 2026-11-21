// The TI-84 Evo, first steps. TI reaches it from its own TI Connect Evo web app over WebUSB and a
// USB-C cable, and its link protocol isn't published, so TIde can't send to it yet. What TIde can
// do already: find it, and read what it tells USB about itself (its IDs, name, interfaces and
// endpoints), which is where supporting it starts. TIde doesn't emulate the Evo.
import { installUsbShim, TI } from "./usb-shim";
import { isTauri } from "@tauri-apps/api/core";

interface UsbEndpoint { endpointNumber: number; direction: string; type: string; packetSize: number }
interface UsbAlternate { alternateSetting: number; interfaceClass: number; interfaceSubclass: number; interfaceProtocol: number; endpoints: UsbEndpoint[] }
interface UsbDevice {
  vendorId: number; productId: number; productName?: string; manufacturerName?: string; serialNumber?: string;
  deviceVersionMajor?: number; deviceVersionMinor?: number;
  configurations: { configurationValue: number; interfaces: { interfaceNumber: number; alternates: UsbAlternate[] }[] }[];
  open(): Promise<void>; close(): Promise<void>;
}

/** USB product IDs of TI devices TILP already knows (libticables), none of them the Evo. */
export const KNOWN_TI_USB: Record<number, string> = {
  0xe001: "SilverLink cable", 0xe003: "TI-84 Plus", 0xe004: "TI-89 Titanium",
  0xe008: "TI-84 Plus Silver Edition or TI-84 Plus CE", 0xe012: "TI-Nspire",
};

const hex = (n: number) => `0x${n.toString(16).padStart(4, "0")}`;

/** From a click: asks for the Evo, opens it, and describes it in the console. Returns a summary for the panel. */
export async function probeEvo(log: (text: string) => void): Promise<string> {
  if (isTauri()) installUsbShim();
  const usb = (navigator as unknown as { usb?: { requestDevice(o: unknown): Promise<UsbDevice> } }).usb;
  if (!usb) throw new Error("This browser has no WebUSB. Use Chrome or Edge, or the desktop app.");
  let device: UsbDevice;
  try { device = await usb.requestDevice({ filters: [{ vendorId: TI }] }); } catch (err) {
    if ((err as { name?: string }).name === "NotFoundError") throw new Error("No calculator was chosen. Plug in the TI-84 Evo with its USB-C cable and try again.");
    throw err;
  }
  return describeDevice(device, log);
}

/** Opens a TI device that isn't one TILP knows (perhaps a TI-84 Evo) and describes it in the console. */
export async function describeDevice(device: UsbDevice, log: (text: string) => void): Promise<string> {
  const known = KNOWN_TI_USB[device.productId];
  const lines = [
    `USB device ${hex(device.vendorId)}:${hex(device.productId)}${device.productName ? ` "${device.productName}"` : ""}${device.manufacturerName ? ` by ${device.manufacturerName}` : ""}`,
    ...(device.deviceVersionMajor !== undefined ? [`  version ${device.deviceVersionMajor}.${device.deviceVersionMinor ?? 0}`] : []),
  ];
  try {
    await device.open();
    for (const config of device.configurations) {
      lines.push(`  configuration ${config.configurationValue}`);
      for (const iface of config.interfaces) for (const alt of iface.alternates) {
        lines.push(`    interface ${iface.interfaceNumber}.${alt.alternateSetting}: class ${alt.interfaceClass}, subclass ${alt.interfaceSubclass}, protocol ${alt.interfaceProtocol}`);
        for (const ep of alt.endpoints) lines.push(`      endpoint ${ep.endpointNumber} ${ep.direction}, ${ep.type}, ${ep.packetSize} bytes`);
      }
    }
  } catch (err) {
    lines.push(`  couldn't open it: ${err instanceof Error ? err.message : err}`);
  } finally {
    await device.close().catch(() => {});
  }
  for (const line of lines) log(line);
  if (known) return `That's a ${known}, not a TI-84 Evo: connect it as a USB calculator.`;
  return `TIde found ${device.productName ?? "the calculator"} (${hex(device.productId)}) and wrote what it reports over USB to the Console. Sending to the TI-84 Evo isn't possible yet: its link protocol isn't published. Until it is, send files with TI Connect Evo (connectevo.ti.com).`;
}
