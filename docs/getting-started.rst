Getting started
===============

Your first TI-BASIC program
---------------------------

1. In **Programs** in the side bar, make a new program and name it, such as ``HELLO``.
2. Type it in the editor. Completions, signature help and hover docs know every command.
3. **Build .8xp** (:kbd:`Ctrl+E`) writes a program the calculator accepts. It asks where to save the
   first time, then rebuilds to the same file.
4. **▶ Run** (:kbd:`F5`) builds it, sends it to the calculator panel and starts it.

Opening a project
-----------------

**File → Open folder…** opens a folder as a project. If its ``.tide/tide.json`` doesn't say which
calculator it's for or what it's written in, TIde asks, a page at a time:

1. **Calculator:** the ones its files point to, with **Other calculators…** in case they're wrong.
2. **Language:** what it's written in. Its files open in this language.
3. **Prerun:** steps Run takes after building and before sending.
4. **Postrun:** steps Run takes once the program is running.

The answer goes in ``.tide/tide.json`` (see :doc:`tide-json`). **Settings → Project** sets when
TIde asks, and **Set up this folder…** there asks again.

What's on the screen
--------------------

- **Activity bar** (left): Explorer, Programs, Source Control, Docs, Extensions, the calculator and
  Settings.
- **Editor**, with tabs. Images open as pictures, and TI files as a summary of what's in them.
- **Panel** (bottom): Output (build and script logs), Terminal and Console (the calculator's).
- **Status bar**: the file's size on the calculator, its encoding, Scripts, ▶ Run and the version.

.. todo:: Add screenshots of the main window, the setup popup and the calculator panel.
