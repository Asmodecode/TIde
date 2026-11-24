Extensions
==========

The **Extensions** view (:kbd:`Ctrl+Shift+X`) lists installed extensions. Use its switch to turn
an extension on or off, **Uninstall** to remove one, or the **More** menu to create, reload, and
install extensions. TIde's calculator language support is supplied by three extensions:

* **CE Languages:** TI-Python, TI-BASIC, CE C, eZ80 assembly and py2ez80.
* **Plus Languages:** z80 assembly and TI-BASIC snippets for the TI-83 Plus and TI-84 Plus.
* **Nspire:** Nspire Lua and Ndless C/C++ support, plus Ndless project and Luna packing commands.

Create an extension
-------------------

Choose **More ▾ → New extension** in the Extensions view. TIde creates an extension folder with an
``extension.json`` manifest and a ``main.js`` starter. You can also create a folder in TIde's
extensions folder (**More ▾ → Open extensions folder**) and add these files yourself. Saving an
extension file reloads extensions, so edits take effect right away.

An extension can contribute editor features in its manifest without JavaScript, and can optionally
run JavaScript from ``main.js``. Here is a small manifest that adds a TI-BASIC snippet, a completion,
and hover help:

.. code-block:: json

   {
     "name": "My TI-BASIC helpers",
     "id": "yourname.tibasic-helpers",
     "version": "1.0.0",
     "description": "A few TI-BASIC helpers.",
     "author": "Your name",
     "contributes": {
       "snippets": [
         {
           "language": "tibasic",
           "prefix": "hello",
           "body": ["Disp \"${1:HELLO}\"", "$0"],
           "description": "Display a greeting"
         }
       ],
       "completions": [
         {
           "language": "tibasic",
           "label": "greeting",
           "insertText": "Disp \"HELLO\"",
           "documentation": "Display a greeting."
         }
       ],
       "hovers": [
         {
           "language": "tibasic",
           "word": "greeting",
           "contents": "Displays a greeting."
         }
       ]
     }
   }

Use ``Ctrl+Space`` in the editor to see snippets and completions. Snippet bodies use Monaco snippet
syntax: ``${1:name}`` marks an editable placeholder, and ``$0`` marks the final cursor position.
Completion ``insertText`` may use that syntax too; set ``"isSnippet": true`` on a completion to
insert it as a snippet. Completion ``kind`` may be ``function``, ``keyword``, ``variable``,
``constant``, ``snippet``, ``type``, ``module`` or ``text``. Hover ``contents`` is plain text or
Markdown.

The ``language`` field is a Monaco language ID. TIde provides ``tibasic``, ``c``, ``cpp``, ``ez80``
(CE assembly), ``z80``, ``python``, ``tipython``, ``py2ez80``, ``lua`` and ``json`` among others.
Extensions can register their own language; use that language's ``id`` in its other contributions.

Add a language
--------------

Add a language contribution under ``contributes.languages`` to register a language ID, file
extensions or names, comments, brackets and syntax highlighting. Highlighting rules use Monaco's
`Monarch tokenizer format <https://microsoft.github.io/monaco-editor/monarch.html>`_. This compact
example highlights ``.foo`` files and treats text after ``#`` as comments:

.. code-block:: json

   {
     "name": "Foo language",
     "contributes": {
       "languages": [
         {
           "id": "foo",
           "name": "Foo",
           "extensions": [".foo"],
           "comments": {"lineComment": "#"},
           "brackets": [["{", "}"], ["(", ")"]],
           "monarch": {
             "tokenizer": {
               "root": [
                 ["#.*$", "comment"],
                 ["\\b[0-9]+\\b", "number"],
                 ["[a-zA-Z_][\\w]*", "identifier"]
               ]
             }
           }
         }
       ]
     }
   }

For an existing language, use ``main.js`` to add a dynamic completion or checker instead of
registering the same language ID again. TIde's own language support extensions are working examples
in the repository's ``extensions/`` folder.

Run extension code
------------------

The extension's ``main.js`` is an ES module. Export ``activate(tide)``; TIde calls it when the
extension starts. It may also export ``deactivate()`` for cleanup. The starter below registers a
command and listens for saved files:

.. code-block:: javascript

   // @ts-check
   /** @param {Tide} tide */
   export function activate(tide) {
     tide.commands.register("count-lines", "Count lines", () => {
       const count = tide.editor.text().split("\\n").length;
       tide.message(`${count} lines`);
     });

     tide.on("save", file => tide.message(`Saved ${file.name}`));
   }

   export function deactivate() {}

The ``Tide`` type is available to ``main.js`` automatically. Add ``// @ts-check`` and annotate the
``tide`` parameter as above for editor type checking and completion. ``extension.json`` is checked
against its schema as you edit it.

The ``tide`` API
----------------

* ``tide.version`` is the running TIde version. ``tide.extension`` describes this extension
  (``id``, ``dir`` and ``manifest``).
* ``tide.commands.register(id, label, run, options?)`` adds a command to the File menu and editor
  right-click menu. ``options`` can include a ``shortcut``. It returns a disposable.
* ``tide.on(event, callback)`` listens for ``open``, ``save``, ``run``, ``project`` or ``settings``
  events. The callback receives event details when available. It returns a disposable.
* ``tide.editor.file()`` returns the current file's ``name``, ``path`` and ``language`` (or ``null``);
  ``text()``, ``setText(text)``, ``selection()`` and ``insert(text)`` read or edit its contents.
* ``tide.languages.completions(language, provider)``, ``hover(language, provider)`` and
  ``signatureHelp(language, provider)`` register Monaco providers. Providers follow Monaco's
  ``provideCompletionItems``, ``provideHover`` and ``provideSignatureHelp`` interfaces.
  ``tide.languages.builtIn(language)`` enables TIde's built-in IntelliSense for ``tibasic``, ``c``,
  ``ez80``, ``python`` or ``tipython``. ``markers(model, markers)`` displays diagnostics as editor
  squiggles.
* ``tide.monaco`` exposes Monaco for advanced editor features. Add disposables from custom Monaco
  registrations to ``tide.subscriptions.push(...)`` so they are disposed with the extension.
* ``tide.project()`` returns the open project's ``root`` and ``name``, or ``null``.
  ``tide.settings()`` returns the settings in use.
* ``tide.message(text)`` shows a status message. ``tide.run(command, directory?)`` runs a command
  in the project and resolves to ``{ok, output}``.
* ``tide.files.read(path)`` reads a text file relative to the extension folder. ``readBinary(path)``,
  ``write(path, text)`` and ``open(path)`` use paths relative to the open project; absolute paths are
  accepted for binary reads and writes.
* ``tide.calculator.show()`` opens the calculator. ``family()`` returns its family or ``null``;
  ``macro(name, argument?)`` runs a calculator macro; and ``send(files)`` sends named byte arrays to
  it.

TIde disposes registrations made through ``tide`` when an extension is turned off or reloaded.
Disable or uninstall an extension from the Extensions view. Extensions with ``main.js`` run code
inside TIde and can use its file and calculator APIs, so install code only from sources you trust.

Share an extension
------------------

Select **Export as .TIdeex…** for an installed extension, or pack its folder into a zip archive. A
``.TIdeex`` is a zip containing ``extension.json`` at the archive root and the files the extension
uses (such as ``main.js``). A zip with one top-level extension folder is accepted too. TIde rejects
unsafe paths and packages larger than 32 MB unpacked.

Install a ``.TIdeex`` by dropping it on TIde, opening it, or choosing **More ▾ → Install from
.TIdeex…**. TIde displays the extension's details and whether it runs code before installation. The
manifest ``id`` (lowercase letters, digits, ``-`` and ``.``) identifies updates; installing a package
with the same ID replaces the installed version. Without an ID, TIde derives a folder name from the
extension's name.

In the browser, bundled extensions run from TIde itself. The browser version does not have a
writable extensions folder for installing user extensions; use the desktop app to develop, install
and export them.
