Developing TIde
===============

This guide is for changing TIde itself: its editor, calculator tools, desktop app, or web app.
If you want to add a user installed language helper or command, see :doc:`extensions` instead.

Get the source running
----------------------

TIde's desktop app uses `Tauri 2 <https://tauri.app/>`_: a TypeScript front end and a Rust back end.
The web app uses the same front end, built with Vite. You need `Node.js 22 <https://nodejs.org/>`_,
`Rust <https://rustup.rs/>`_, and `Tauri's system prerequisites
<https://tauri.app/start/prerequisites/>`_ for your operating system.

From a checkout of the repository, install the locked JavaScript dependencies and start the desktop
app:

.. code-block:: sh

   npm ci
   npm run tauri dev

The Vite front end reloads as you edit TypeScript, styles, and other front end files. Rust changes
may require the desktop app to rebuild. To run just the browser version during development, use:

.. code-block:: sh

   npm run dev

The browser version has its own storage and browser file-system permissions. It does not have the
desktop terminal, source control integration, or native serial and USB support. Build a production
web bundle with:

.. code-block:: sh

   npm run build:web

This writes the site to ``dist-web``. ``npm run build`` builds the desktop front end, and
``npm run tauri build`` builds desktop installers for the current platform.

Find the code
-------------

The repository is split by responsibility:

* ``src/main.ts`` wires together the front end and its views. Start here to trace application flow,
  menus, tabs, and how the editor connects to other features.
* ``src/`` contains the TypeScript application: calculator and emulator UI (``calc.ts``), project
  configuration (``config.ts``), language support and build tools, settings, files, serial
  connections, and web storage.
* ``src-tauri/src/`` contains the Rust desktop back end. ``lib.rs`` registers Tauri commands;
  modules such as ``project.rs``, ``serial.rs``, ``link.rs``, ``pty.rs`` and ``git.rs`` implement
  native file, calculator, terminal and source control operations.
* ``extensions/`` contains language features and calculator support shipped with TIde. These
  contribute through the extension system; changes to the extension host itself belong in
  ``src/extensions.ts``.
* ``vite.config.ts``, ``index.html`` and ``public/`` configure the web build, app shell, and static
  assets. ``src-tauri/tauri.conf.json`` configures the desktop app.
* ``docs/`` contains this Sphinx documentation. ``.github/workflows/`` contains build, release,
  and documentation publishing workflows.

When adding a feature, trace an existing similar feature from its UI in ``src/main.ts`` through its
TypeScript module and, where needed, the Tauri command in Rust. Keep platform-specific behavior
behind the existing filesystem, calculator, or shell interfaces so the browser build can provide
its own implementation or a clear unsupported state.

Check a change
--------------

Before opening a pull request, run the checks relevant to your change:

.. code-block:: sh

   npx tsc --noEmit
   cd src-tauri
   cargo test --lib

For front end changes, also run ``npm run tauri dev`` or ``npm run dev`` and exercise the changed
flow in the app where it is supported. For web-only behavior, ``npm run build:web`` checks the
production web bundle. The repository does not define a single front end test command; run the
manual checks that cover the behavior you changed.

Build the documentation locally with Sphinx:

.. code-block:: sh

   cd docs
   pip install -r requirements.txt
   make html

Open ``docs/_build/html/index.html`` to review the rendered pages. Sphinx is configured to treat
warnings as errors, matching the hosted documentation builds.

Contribute a change
-------------------

For bugs and feature ideas, open an `issue <https://github.com/XSamuraiCoder/TIde/issues>`_. For
code changes, fork the repository, make a branch, and open a pull request targeting ``main``. Explain
what changed and how you checked it; update the README or docs when behavior or setup instructions
change.

TIde is free software under the GNU General Public License v3.0 or later. Contributions are made
under that license.

Build and release notes
-----------------------

The `Build workflow <https://github.com/XSamuraiCoder/TIde/actions/workflows/build.yml>`_ creates a
nightly build for pushes to ``main``. Version tags such as ``v2.0.1`` create stable releases; the tag
must match ``version`` in ``src-tauri/tauri.conf.json``. Update artifacts are signed, so release
builds need the ``TAURI_SIGNING_PRIVATE_KEY`` and
``TAURI_SIGNING_PRIVATE_KEY_PASSWORD`` repository secrets.

The ``web`` job publishes the stable site and nightly site to GitHub Pages. The Docs workflow
publishes ``docs/`` from the ``docs`` branch at
`xsamuraicoder.github.io/TIde/docs <https://xsamuraicoder.github.io/TIde/docs/>`_. The hosted
documentation can also be built by Read the Docs using ``.readthedocs.yaml``.
