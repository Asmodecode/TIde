Installation
============

Download TIde from the `latest release <https://github.com/XSamuraiCoder/TIde/releases/latest>`_, or
use it in your browser (see :doc:`web`). In the file names below, ``<version>`` is the release's
version, such as |release|.

macOS
-----

1. Download ``TIde_<version>_aarch64.dmg`` for a Mac with Apple Silicon (M1 and later), or
   ``TIde_<version>_x64.dmg`` for an Intel Mac. Not sure? Apple menu → **About This Mac**:
   "Chip: Apple M…" is Apple Silicon.
2. Open the ``.dmg`` and drag **TIde** into **Applications**.
3. **Run this once in Terminal before opening TIde:**

   .. code-block:: sh

      xattr -cr /Applications/TIde.app

.. important::

   TIde isn't signed with an Apple developer certificate, so macOS quarantines the downloaded app
   and, when you open it, says **"TIde is damaged and can't be opened"** or that Apple can't check
   it for malicious software. It isn't damaged: ``xattr -cr`` removes the quarantine mark, and TIde
   then opens normally. You only do it once; TIde's own updates aren't quarantined.

The ``.app.zip`` files hold the same ``TIde.app`` without an installer: unzip it, move it where you
like, and run ``xattr -cr`` on it there, for example ``xattr -cr ~/Downloads/TIde.app``.

Windows
-------

- **Installer:** ``TIde_<version>_x64-setup.exe``, or ``TIde_<version>_x64_en-US.msi``. TIde isn't
  signed with a code-signing certificate, so Windows may show **"Windows protected your PC"**: click
  **More info**, then **Run anyway**.
- **Portable:** ``TIde_<version>_x64-portable.exe`` runs on its own, with nothing to install. It
  needs WebView2, which Windows 11 already includes, and it keeps your programs in your user folder.

Linux
-----

- **Debian, Ubuntu and similar:** ``sudo apt install ./TIde_<version>_amd64.deb``
- **Fedora, openSUSE and similar:** ``sudo dnf install ./TIde-<version>-1.x86_64.rpm``
- **Any distribution:** ``chmod +x TIde_<version>_amd64.AppImage``, then run it.

Updates and nightlies
---------------------

The installed app updates itself: it checks for a new release when it starts and offers it, with
its release notes. The portable exe and the ``.app.zip`` don't update themselves.

**Settings → Updates → Update channel** switches to **Nightly**: every build of TIde's ``main``
branch, with the newest changes before they're released. A nightly is numbered after the release it
leads to (``2.0.2-51`` comes before ``2.0.2``), so the next stable release still reaches nightly
users. The nightly installers are on the
`latest build <https://github.com/XSamuraiCoder/TIde/releases/tag/latest>`_ prerelease; on Linux
they're the ``.deb`` and the AppImage, since an ``.rpm`` can't carry a nightly's version.
