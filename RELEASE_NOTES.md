## TIde 1.6.0

- **Real calculators:** choose **Real calculator (USB)** in the calculator's model menu and press Connect to send files and programs straight to your calculator, through TILP's libraries. It works with every calculator TILP supports: the USB TI-84 Plus family and the CE, and the older models over a SilverLink cable. On Windows, install the WinUSB driver for the calculator or cable with Zadig first, as for TILP.
- **A real terminal:** the Terminal tab now runs your own shell (PowerShell on Windows) in xterm.js, so `cd`, history, tab completion, colors and full-screen programs all work. **+ New terminal** starts a fresh one in the open folder.
- **Light mode:** Settings → Appearance → Theme, or **Light mode** in the File menu. **Same as the system** follows Windows.
- **Drag and drop:** drag files and folders onto another folder in the Explorer to move them. Drop files from outside onto the Explorer to copy them into the project, onto the editor to open them, or onto the calculator to send them.
- **Indentation:**
  - Files keep the indentation they already use, tabs or spaces, and Makefiles always get tabs.
  - TI-BASIC can be indented for reading. Builds leave the indentation out, so it no longer adds spaces to your program.
  - Enter indents after Then, Else, For(, While and Repeat, and End and Else move back out as you type them.
- **Format document** (Shift+Alt+F, or right-click in the editor) re-indents TI-BASIC, C, Python and assembly.
- **Auto save:** turn it on in the File menu, and changed files save a second after you stop typing.
- **Docs in a tab:** the docs open in a tab of their own (Ctrl+Shift+J), so you can switch between them and your code.
- **The web version:** TIde also runs in the browser, on GitHub Pages, with folders on your computer or projects kept in the browser.
- **Fixed:** hiding the side bar no longer breaks the layout.
