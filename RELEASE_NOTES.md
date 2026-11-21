## TIde 1.7.0

- **Serial cables:** TIde now sends files to calculators on a serial cable, such as TI's grey TI-Graph Link (on a serial port, or a USB-to-serial adapter with one), using its own link code: no WebTILP. Open it from **File → Serial cable…**, a tab of its own: pick the calculator, connect, then drop or pick files to send, and see what went.
  - The TI-84 Plus, 84 Plus SE, 83 Plus and 83 Plus SE (through their I/O port), the TI-83 and the TI-73 take files at the home screen. On a TI-82, start Link > Receive first.
  - Programs, lists, pictures, groups and other variables go over the cable. Flash apps (.8xk) and OS files still go over USB.
  - While it's connected, Run and Send in the calculator panel use the cable too.
  - This is new: if your cable or calculator doesn't connect, please open an issue saying which ones.
- **A device chooser in the desktop app:** connecting to a calculator over USB, or to a serial port, opens TIde's own window listing what's plugged in, where it used to pick the first one it found. Devices plugged in while it's open show up.
- **tide.json `"link"`:** a project can name its cable, port and calculator, such as `{ "via": "serial", "port": "COM3", "model": "TI-84 Plus" }`. Opening the project switches the calculator panel to it.
- **TI-84 Evo, first steps:** the calculator menu can find a TI-84 Evo and write what it reports over USB to the Console. Sending to it isn't possible yet, as its link protocol isn't published; until it is, use TI Connect Evo.
- **The web version** (https://xsamuraicoder.github.io/TIde/) has had two patches since 1.6.0, both in here too: C programs build in the browser, Open folder uses your browser's own folder picker everywhere, and the tab has TIde's icon.

Everything new in 1.6.0 is here too: real calculators over USB, the terminal, light mode, drag and drop, indentation and auto save.
