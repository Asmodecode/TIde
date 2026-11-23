The calculator panel
====================

The calculator icon in the activity bar runs a calculator inside TIde, in its own tab. Pick one in
the model menu, which lists the calculators you have images for.

Emulated calculators
--------------------

.. list-table::
   :header-rows: 1
   :widths: 40 25 35

   * - Calculators
     - Emulator
     - Needs
   * - TI-84 Plus CE, TI-83 Premium CE, TI-82 Advanced Edition Python
     - `CEmu <https://github.com/CE-Programming/CEmu>`_
     - A 4 MB ROM
   * - TI-73, 81, 82, 83, 83 Plus, 83 Plus SE, 84 Plus, 84 Plus SE, 85, 86
     - `Wabbitemu <https://github.com/sputt/wabbitemu>`_
     - A ROM (16 KB to 2 MB) or a Wabbitemu save
   * - TI-Nspire CX (CX and CX II)
     - `Firebird <https://github.com/nspire-emus/firebird>`_
     - A boot1 image (512 KB) and a flash image (33 or 132 MB)

All three emulators are built into TIde. It never ships or downloads a ROM: dump one from your own
calculator.

Calculator images
-----------------

**Add a ROM…** in the model menu opens the images popup, with a tab for each family. Every ROM or
image is a card that says what it is and has buttons to start, replace or remove it.

- **What a ROM is:** TIde reads it from its bytes. A CE ROM's model and boot code version come from
  its certificate, as CEmu reads them; any other ROM's model and OS, as Wabbitemu reads them. So the
  menu says "TI-83 Premium CE · boot 5.3.6.0014" or "TI-84 Plus · OS 2.55MP".
- **Several of the same calculator:** keep as many ROMs as you like. A second one with the same file
  name is kept as ``name (2)``.

Running and sending
-------------------

- **▶ Run** (:kbd:`F5`) builds the active program or project, sends it and starts it.
- **Send files…**, or dropping files on the calculator, sends any TI file: programs, appvars, lists,
  groups, pictures, apps, OS files and bundles.
- The **Console** in the panel shows the emulator's output, including ``dbg_printf`` from C programs.

The keypad
----------

Each keypad is laid out like its calculator's. Every key shows what 2nd and alpha make of it above
it, lit up while 2nd or alpha waits for the next key. The TI-81, 82, 83, 85 and 86 have their own
labels, and the TI-Nspire CX its own keyboard with the touchpad. Click the screen to type with
CEmu's default keys.
