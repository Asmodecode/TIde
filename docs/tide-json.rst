The project file: tide.json
===========================

A project's ``.tide/tide.json`` tells TIde which calculator it's for, what it's written in, how it
builds, what Run does and sends, its scripts and its editor settings. Comments are allowed, and the
editor completes and checks it.

.. code-block:: javascript

   {
     // How TIde builds and runs this project.
     "calculator": "ce",
     "language": "c",
     "build": "make",
     "prerun": [],
     "postrun": ["wait(1000)", "key.press(enter)"],
     "send": ["bin/*.8xp", "bin/*.8xv"],
     "libraries": true,
     "runIn": "calculator",
     "scripts": { "clean": "make clean" }
   }

Keys
----

``calculator``
   ``"ce"`` (the TI-84 Plus CE), ``"plus"`` (the TI-84 Plus) or ``"nspire"`` (the TI-Nspire CX).
   It sets TI-BASIC's screen checks and commands, and what Build and Run make, while the project is
   open.

``language``
   ``"tibasic"``, ``"c"``, ``"cpp"``, ``"ez80"``, ``"z80"``, ``"tipython"``, ``"py2ez80"`` or
   ``"lua"``. In a ``py2ez80`` project, ``.py`` files open as py2ez80; in a ``z80`` one, assembly
   opens as z80.

``build``
   The command line Build (:kbd:`Ctrl+E`) runs, and Run runs first, in the project folder. Without
   it, a folder with a Makefile runs ``make``.

``prerun``
   Steps Run takes after building and before sending. If one fails, nothing is sent.

``postrun``
   Steps Run takes after the program starts.

``send``
   Files Run sends, relative to the project. ``*`` and ``?`` match within a name, as in
   ``bin/*.8xp``.

``program``
   The program Run starts, without ``prgm``. Leave it out to start the first ``.8xp`` sent, or set
   ``""`` to only send.

``libraries``
   The CE C libraries (``clibs.8xg``), sent first, once per calculator session: ``true`` finds them,
   ``false`` sends none, or list the files.

``runIn``
   Where Run goes: ``"calculator"`` (TIde's) or ``"cemu"`` (the CEmu app).

``link``
   A real calculator this project sends to, such as
   ``{ "via": "serial", "port": "COM3", "model": "TI-84 Plus" }``.

``scripts``
   Named command lines, run from **Scripts** in the status bar.

``editor``
   Editor settings used instead of yours while the project is open, such as ``{ "tabSize": 2 }``.

Steps
-----

A step in ``prerun`` or ``postrun`` is a shell command line, or one of these calculator macros:

.. list-table::
   :header-rows: 1

   * - Macro
     - Does
   * - ``key.press(key)``
     - Presses a key: ``enter``, ``clear``, ``2nd``, ``alpha``, ``mode``, the arrows, a digit…
   * - ``key.type("TEXT")``
     - Types letters and digits, as with alpha.
   * - ``program.run(NAME)``
     - Runs a program from the home screen. ``program.open`` is the same.
   * - ``app.open(NAME)``
     - Opens an app from the apps menu.
   * - ``wait(ms)``
     - Waits a number of milliseconds.

Command lines run in the system shell (cmd on Windows, sh elsewhere), so ``&&``, pipes, redirects
and variables work as in a terminal.
