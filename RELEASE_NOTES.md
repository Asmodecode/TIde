## Coming in TIde 2.1.2

New in the nightly builds since 2.1.1:

- **Settings fit your project:** with a folder open, Settings shows only what applies to it, from its `tide.json` calculator and language. TI-BASIC settings show in TI-BASIC projects, the CE toolchain and `clibs.8xg` in CE C projects, and the Ndless SDK and Luna in Nspire ones. **Show all** brings back the rest. With no folder open, project settings don't show at all.
- **Toolchain folders:** a new **Toolchains** section in Settings (desktop app) has the **CE toolchain folder** (`CEDEV`), the **Ndless SDK folder**, the **Luna command**, and **More folders on PATH** for tools like spasm-ng, Python or SDCC. Every build, script, prerun and postrun step uses them, and Run looks for `clibs.8xg` in the CE toolchain folder. A path can start with `~`.
- **Install the toolchain from TIde:** when you open a project, or build one, whose toolchain isn't installed, TIde asks about it. For CE C projects it can download and install the official CE toolchain (CEdev) itself, and use it for every CE project. For the Ndless SDK and Luna, which have no ready-made downloads, it links to how to install them and lets you show it where yours is. It also says when `make` is missing. **Don't ask again** turns it off for that project.
- **Commands for your project:** the Nspire extension's commands appear in the File menu only in TI-Nspire projects. Extension authors can do the same with `tide.commands.register(…, { when: { calculator: ["nspire"] } })`, and `tide.project()` now includes the project's calculator and language.
- **New dropdowns:** every dropdown opens TIde's own list instead of the system's grey one, in dark and light mode. Use the arrow keys, or type to jump to an option. Text boxes, search boxes and number fields share one look and focus ring.
- **Linux:**
  - TIde's icon now shows on Wayland when it runs from the `.tar.gz` or an AppImage, not only when it's installed from a package.
  - The window icon is sharp on X11.
  - The app menu lists TIde under Development instead of Lost & Found.
  - The `.deb` package is now named `tide` instead of `t-ide`, and installing it replaces `t-ide`.

## TIde 2.1.1

- **Linux updates that couldn't install now can:** the updater only knew how to replace an AppImage or install a `.deb` or `.rpm`, so TIde installed any other way (a converted package, a copy in a folder only root can change) couldn't update itself. Each release now includes `TIde_<version>_amd64.tar.gz`, signed like the other updates, and when the usual update fails TIde installs from it instead, asking for your password if the folder needs it. It's also a way to run TIde without installing it: unpack it and run `TIde/tide`. This works from 2.1.1 on, so an install that can't update from 2.1.0 needs 2.1.1 downloaded once by hand.

### Also in 2.1.0

- **What's a ROM?** The **Calculator images** window now explains what a ROM is and why TIde can't include one, on every tab. Thanks to @Asmodecode for this, in their first contribution to TIde (#3).
- **New type:** TIde now comes with its own fonts, Inter for the interface and JetBrains Mono for code, the terminal and the console, so it looks the same on every system, offline too.
- **The calculator panel:**
  - **Calculator images** no longer shrinks to a single line: the window fits its images and scrolls when there are many.
  - The model menu matches the rest of the bar instead of showing the system's grey box, and the bar wraps onto a second row in narrow windows.
  - In small windows, the screen and keypad can always be scrolled into view.
  - In light mode, pressed keys keep their colours.
- **Linux:** TIde's icon now shows on Wayland desktops, in the taskbar and window switcher, and the packages include sharper large icons.

Everything in 2.0.1 and 2.0.0 is here too: nightly updates, the installable web version, the TI-Nspire CX, every CE calculator, setting up a folder, and images in the editor.
