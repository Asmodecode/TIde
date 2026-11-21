## TIde 1.7.0

- **Connect a calculator:** one popup lists every way TIde can reach a real calculator, whatever the protocol: calculators over USB, the SilverLink cable, and serial ports with TI's grey TI-Graph Link. Open it from the calculator panel's **Real calculator**, or **File → Connect a calculator…**. In a browser, its Allow buttons ask for a new USB device or serial port.
- **Serial cables:** TIde now sends files to calculators on a serial cable, using its own link code, built to match TILP's. The TI-84 Plus, 84 Plus SE, 83 Plus and 83 Plus SE (through their I/O port), the TI-83 and the TI-73 take files at the home screen; on a TI-82, start Link > Receive first.
  - **It finds them:** a serial port's calculator can be left on **Find out**, and TIde asks it which it is. **Find my calculator** tries every serial port.
  - **It runs programs:** Run sends the program and starts it, pressing the calculator's keys over the cable. In `tide.json`, `key.press`, `key.type` and `app.open` act on the calculator too. (Not on the TI-82, which can't be controlled over the cable.)
  - **It recovers:** a send that gets no answer is tried again, a damaged packet is asked for again, and a group that stops partway says where, and goes on from there when it's sent again.
  - The **Serial** tab (File → Serial cable…) sends files dropped or picked there, and lists what went.
  - This is new: if your cable or calculator doesn't connect, please open an issue saying which ones.
- **Files changed outside TIde:** an open file that changes on disk (another editor, git, a build) reloads in its tab, keeping your place and undo history. If you have unsaved changes in it, TIde keeps them and says so: saving then asks before overwriting, and **File → Reload from disk** takes the disk's version. A deleted file's tab stays open. The web version checks a folder you opened every couple of seconds.
- **`tide.json` `"link"`:** a project can name its cable, port and calculator, such as `{ "via": "serial", "port": "COM3", "model": "TI-84 Plus" }`.
- **TI-84 Evo, first steps:** the connections popup lists a TI device TILP doesn't know, which may be a TI-84 Evo, and can describe what it reports over USB in the Console. Sending to it isn't possible yet, as its link protocol isn't published; until it is, use TI Connect Evo.
- **The web version** (https://xsamuraicoder.github.io/TIde/):
  - Build lines with `&&` run each `make` in turn, with `-C folder`, `VAR=value` and `make clean`. A makefile's own rules are followed as make would; the steps that need a shell are left out, and the build says which.
  - Since 1.6.0, its patches also brought C programs building in the browser, your browser's own folder picker for Open folder, and TIde's icon on its tab.

Everything new in 1.6.0 is here too: real calculators over USB, the terminal, light mode, drag and drop, indentation and auto save.
