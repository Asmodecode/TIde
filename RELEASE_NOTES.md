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
