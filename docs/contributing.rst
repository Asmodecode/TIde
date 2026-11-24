Contributing
============

Thanks for helping with TIde.

- **Bugs and ideas:** open an `issue <https://github.com/XSamuraiCoder/TIde/issues>`_. For a cable
  or calculator that doesn't connect, say which ones.
- **Changes:** work on ``main`` and push commits directly to it. Pushes build a nightly desktop
  release and publish the nightly web app; documentation changes also publish the docs site.

Before pushing a change:

1. ``npx tsc --noEmit`` passes.
2. ``cargo test --lib`` passes in ``src-tauri``.
3. If it changes what TIde does, the README and these docs say so.

TIde is free software under the GNU General Public License v3.0 or later; what you contribute is
under it too.
