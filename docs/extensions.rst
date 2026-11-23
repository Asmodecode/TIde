Extensions
==========

The **Extensions** view (:kbd:`Ctrl+Shift+X`) lists every extension, with a switch to turn it on or
off, and **Uninstall**. TIde's language support comes as three extensions, installed the first time
TIde runs and updated with it:

- **CE Languages:** TI-Python, TI-BASIC, CE C, eZ80 assembly and py2ez80 on the TI-84 Plus CE.
- **Plus Languages:** z80 assembly and TI-BASIC snippets for the TI-83 Plus and 84 Plus.
- **Nspire:** Nspire Lua and the Ndless SDK's C and C++ API, and commands for Ndless projects and
  Luna packing.

Making one
----------

An extension is a folder in TIde's extensions folder (**More ▾ → Open extensions folder**) with an
``extension.json``. **More ▾ → New extension** makes one from a template and opens it; saving its
files reloads it.

.. code-block:: javascript

   {
     "name": "My Snippets",
     "version": "1.0.0",
     "main": "main.js",          // optional: code that runs
     "contributes": {
       "completions": [
         {
           "language": "tibasic",
           "label": "hello",
           "insertText": "Disp \"HELLO\"",
           "documentation": "Says hello."
         }
       ]
     }
   }

Sharing one
-----------

An extension packs into a ``.TIdeex`` file. Dropping one on TIde, or **Install from .TIdeex…**,
installs it.

.. todo:: Document every ``contributes`` point and the API ``main.js`` gets.
