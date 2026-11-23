Languages
=========

What TIde builds, and for which calculator. A project's ``"language"`` in :doc:`tide-json` says
which of these it is.

.. list-table::
   :header-rows: 1
   :widths: 18 30 52

   * - Language
     - Calculators
     - How TIde builds it
   * - TI-BASIC
     - TI-84 Plus CE, TI-84 Plus
     - Tokenized into an ``.8xp`` by TIde itself. CE-only commands are flagged on the Plus.
   * - C and C++
     - TI-84 Plus CE; TI-Nspire CX
     - ``make``, with the `CE C toolchain <https://github.com/CE-Programming/toolchain>`_, or the
       Ndless SDK for the Nspire.
   * - eZ80 assembly
     - TI-84 Plus CE
     - fasmg in a C project, or spasm-ng for a single file (``.asm``, ``.s``, ``.src``, ``.inc``,
       ``.ez80``).
   * - z80 assembly
     - TI-83 Plus, TI-84 Plus
     - spasm-ng (``.z80``, or any assembly in a ``z80`` project).
   * - TI-Python
     - TI-84 Plus CE Python, TI-84 Evo, TI-Nspire
     - Runs as it is; on the Nspire, packed into a ``.tns`` with Luna.
   * - py2ez80
     - TI-84 Plus CE
     - Compiled to a CE program by `py2ez80 <https://github.com/Voblit/py2ez80>`_.
   * - Lua
     - TI-Nspire CX
     - Packed into a ``.tns`` with Luna.

TI-BASIC
--------

- Completions, signature help, hover docs and block folding.
- Checks for unclosed blocks, missing labels, off-screen positions and likely typos.
- The tokenized size in the status bar, which is what the calculator will store.
- Indentation is for reading only: a build leaves it out.

The calculator a program is for sets its screen checks:

.. list-table::
   :header-rows: 1

   * -
     - TI-84 Plus CE
     - TI-84 Plus
   * - Home screen
     - 26 × 10
     - 16 × 8
   * - Graph screen
     - 265 × 165
     - 95 × 63
   * - Color and other CE-only commands
     - Available
     - Marked as errors and left out of the ``.8xp``

.. todo:: A page for each language: its snippets, checks and the docs TIde has for it.
