Extension development guide
===========================

This guide covers only TIde extensions: add-ons that contribute language support and editor or
calculator tools. An extension can use a manifest for static editor features and optional JavaScript
for behavior that needs code.

Create a project
----------------

In the desktop app, open the Extensions view with :kbd:`Ctrl+Shift+X` and choose
**More → New extension**. TIde creates an extension folder with ``extension.json`` and a ``main.js``
starter. You can also create those files in the extensions folder, opened with **More → Open
extensions folder**. Saving an extension file reloads extensions.

The extension folder is the project root. A minimal extension needs a manifest:

.. code-block:: json

   {
     "name": "My TI-BASIC helpers",
     "id": "yourname.tibasic-helpers",
     "version": "1.0.0",
     "description": "Snippets and editor help for TI-BASIC.",
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

The ``id`` uses lowercase letters, digits, periods, and hyphens. Keep it stable: TIde uses it to
identify the extension and replace it when a user installs an update. The manifest is checked as you
edit it; hover fields in the editor for schema help.

Contribute editor features
--------------------------

The ``contributes`` object supports four kinds of static contributions:

* **Snippets** have ``language``, ``prefix``, and ``body`` fields. ``body`` can be a string or an
  array of lines and uses Monaco snippet syntax: ``${1:name}`` creates an editable placeholder and
  ``$0`` marks the final cursor position. Use :kbd:`Ctrl+Space` in the editor to find a snippet.
* **Completions** have ``language`` and ``label`` fields, plus optional ``insertText``, ``detail``,
  ``documentation``, and ``kind``. If ``insertText`` contains ``$`` snippet markers, TIde inserts it
  using Monaco snippet syntax. Valid ``kind`` values are ``function``, ``keyword``, ``variable``,
  ``constant``, ``snippet``, ``type``, ``module``, and ``text``.
* **Hovers** have ``language``, ``word``, and ``contents`` fields. ``contents`` accepts plain text or
  Markdown.
* **Languages** register an ``id`` and can include ``name``, ``extensions``, ``filenames``,
  ``comments``, ``brackets``, and a ``monarch`` tokenizer. Tokenizer rules use
  `Monaco Monarch syntax <https://microsoft.github.io/monaco-editor/monarch.html>`_.

The ``language`` value is a Monaco language ID. TIde includes IDs such as ``tibasic``, ``c``,
``cpp``, ``ez80``, ``z80``, ``python``, ``tipython``, ``py2ez80``, ``lua``, and ``json``. When you
contribute a new language, use its ID for that extension's snippets, completions, hovers, and
JavaScript providers. Do not register an ID that is already in use.

Here is a minimal language contribution for ``.foo`` files:

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

For working examples, inspect the built-in extension folders in the `TIde source <https://github.com/XSamuraiCoder/TIde/tree/main/extensions>`_.

Add JavaScript behavior
-----------------------

Set ``"main": "main.js"`` in the manifest when the extension needs code. ``main.js`` is an ES
module. Export ``activate(tide)``; TIde calls it when the extension starts. It can also export
``deactivate()`` for cleanup.

.. code-block:: javascript

   // @ts-check
   /** @param {Tide} tide */
   export function activate(tide) {
     tide.commands.register("count-lines", "Count lines", () => {
       const count = tide.editor.text().split("\n").length;
       tide.message(`${count} lines`);
     });

     tide.on("save", file => tide.message(`Saved ${file.name}`));
   }

   export function deactivate() {}

The ``Tide`` type is available automatically. Keep ``// @ts-check`` and the JSDoc parameter type to
get editor completions and type checking while writing ``main.js``.

Extension API
-------------

* ``tide.version`` is the running TIde version. ``tide.extension`` describes the extension with its
  ``id``, ``dir``, and ``manifest``. ``tide.monaco`` exposes Monaco for advanced editor features.
* ``tide.commands.register(id, label, run, options?)`` adds a command to the File menu and editor
  context menu. ``options`` can include a ``shortcut``.
* ``tide.on(event, callback)`` listens for ``open``, ``save``, ``run``, ``project``, or ``settings``
  events. The callback receives event details when available.
* ``tide.editor.file()`` returns the current file's ``name``, ``path``, and ``language`` or ``null``.
  ``text()``, ``setText(text)``, ``selection()``, and ``insert(text)`` read or edit its contents.
* ``tide.languages.completions(language, provider)``, ``hover(language, provider)``, and
  ``signatureHelp(language, provider)`` register Monaco providers. ``builtIn(language)`` enables
  TIde's built-in IntelliSense for ``tibasic``, ``c``, ``ez80``, ``python``, or ``tipython``.
  ``markers(model, markers)`` displays diagnostics in the editor.
* ``tide.subscriptions.push(disposable, ...)`` tracks custom Monaco registrations. TIde disposes
  tracked registrations when the extension stops; registrations made through the ``tide`` API are
  tracked automatically.
* ``tide.project()`` returns the current project's ``root`` and ``name`` or ``null``.
  ``tide.settings()`` returns the settings in use. ``tide.message(text)`` shows a status message.
* ``tide.run(command, directory?)`` runs a command in the open project and resolves to
  ``{ok, output}``.
* ``tide.files.read(path)`` reads text relative to the extension folder. ``readBinary(path)``,
  ``write(path, text)``, and ``open(path)`` use paths relative to the open project. Binary reads and
  writes also accept absolute paths.
* ``tide.calculator.show()`` opens the calculator. ``family()`` returns its family or ``null``;
  ``macro(name, argument?)`` runs a calculator macro; and ``send(files)`` sends named byte arrays.

Registrations are removed when an extension is disabled or reloaded. Extensions with ``main.js`` run
inside TIde and can access the APIs above. Only install code from sources you trust.

Develop and package
-------------------

Try the extension in the desktop app. Use the Extensions view to enable or disable it, inspect its
contributions and errors, reload it, or uninstall it. Saving extension files reloads them, so iterate
by editing the manifest or JavaScript and trying the change again.

When it is ready, select **Export as .TIdeex…** for the installed extension. A ``.TIdeex`` is a zip
containing ``extension.json`` at its root and the files the extension uses, such as ``main.js``.
Regular zip archives are accepted too; a single top-level extension folder is stripped. TIde rejects
unsafe paths and packages larger than 32 MB unpacked.

Install a package by opening it, dropping it on TIde, or choosing
**More → Install from .TIdeex…**.
TIde displays the extension details and whether it runs code before installation. A package with the
same ``id`` replaces the installed extension, so users can install future versions as updates.

User-installed extensions are currently supported in the desktop app. The browser build runs its
built-in extensions from TIde itself and has no writable extensions folder.
