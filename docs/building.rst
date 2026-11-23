Building TIde
=============

TIde is a `Tauri 2 <https://tauri.app/>`_ app: a TypeScript front end with the Monaco editor, and a
Rust back end in ``src-tauri``.

You need `Node.js <https://nodejs.org/>`_ 22 and `Rust <https://rustup.rs/>`_, plus
`Tauri's prerequisites <https://tauri.app/start/prerequisites/>`_ for your system.

.. code-block:: sh

   npm ci
   npm run tauri dev       # run it, reloading as you change it
   npm run tauri build     # build the installers

The web version
---------------

.. code-block:: sh

   npm run build:web       # into dist-web

Tests
-----

.. code-block:: sh

   npx tsc --noEmit        # type-check the front end
   cd src-tauri && cargo test --lib

These docs
----------

They're in ``docs/``, built with `Sphinx <https://www.sphinx-doc.org/>`_ and the
`Read the Docs theme <https://sphinx-rtd-theme.readthedocs.io/>`_:

.. code-block:: sh

   cd docs
   pip install -r requirements.txt
   make html               # then open _build/html/index.html

Read the Docs builds them from ``.readthedocs.yaml`` at the repository's root.

Releases
--------

- **Every push to main** builds a nightly: versioned as the next patch with the run number, on the
  rolling ``latest`` prerelease, with ``nightly.json``, and the nightly web version.
- **A version tag** (``v2.0.1``) builds that version as a stable release, with ``latest.json``,
  and the stable web version. The tag must match the version in ``src-tauri/tauri.conf.json``.

Update files are signed: the workflow needs the signing key as the ``TAURI_SIGNING_PRIVATE_KEY``
repository secret.
