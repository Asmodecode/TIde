## TIde 1.5.0

- **Output, Terminal and Console:** a panel under the editor, opened from the new **Terminal** and **Output** buttons on the status bar (or ``Ctrl+` `` and `Ctrl+Shift+U`).
  - **Output** shows the full log of every build, prerun, postrun and script as it runs, with colors, errors in red, the exit code and how long it took. **■ Stop** ends it.
  - **Terminal** runs command lines in your system shell, starting in the open folder, with `cd`, history, input for running commands, and Stop (`Ctrl+C`).
  - **Console** is the calculator's console (`dbg_printf` from C programs and emulator messages), moved here from under the calculator. The calculator bar's **Console** button opens it.
- **Shell commands in .tide/tide.json:** `build`, `prerun`, `postrun` and `scripts` run in the system shell, so `&&`, pipes, redirects and variables work as in a terminal.
- **IntelliSense from the catalogs:** problems show as you type, with quick fixes (Ctrl+.).
  - **C:** a wrong number of arguments to a CE library function is an error, a missing `#include` gets a one-click fix, and a misspelled library function gets "did you mean". Signature help highlights the argument you're on, and hover says which header a function is in.
  - **Assembly:** a misspelled instruction, directive or OS routine gets "did you mean"; F12 goes to a label.
  - **py2ez80:** a `graphics.`, `math.` or `random.` name the module doesn't have, a module used without `import` (with a fix), and wrong argument counts.
  - **Outline:** Ctrl+Shift+O lists a C file's functions, an assembly file's labels and a program's `Lbl`s.
- **Live Explorer:** files that a build, the terminal or another program creates, changes or deletes show in the Explorer at once.
