Making TIde extensions
======================

Create add-ons for TIde: add language support, snippets, completions, hover help, commands, and
calculator or project tools. Start with :doc:`extensions` for a step-by-step guide to creating,
testing, and sharing an extension.

Extensions run inside TIde. Manifest contributions can add editor features without JavaScript;
``main.js`` can use TIde's extension API for commands, events, editor access, files, and calculators.
User-installed extensions are available in the desktop app.

About TIde
----------

TIde is a desktop and web IDE for TI calculators. It supports TI-BASIC, CE C and C++, eZ80 and z80
assembly, TI-Python, py2ez80, TI-Nspire Ndless C/C++, and Lua. It can emulate calculators or connect
to a real one over a cable.

- **Download TIde:** the `latest release <https://github.com/XSamuraiCoder/TIde/releases/latest>`_,
  for Windows, macOS and Linux. See :doc:`installation`.
- **Open TIde in a browser:** `xsamuraicoder.github.io/TIde
  <https://xsamuraicoder.github.io/TIde/>`_.
- **Source code:** `github.com/XSamuraiCoder/TIde
  <https://github.com/XSamuraiCoder/TIde>`_.

.. toctree::
   :maxdepth: 2
   :caption: Make extensions

   extensions

.. toctree::
   :maxdepth: 2
   :caption: Use TIde

   installation
   getting-started
   languages
   calculator
   real-calculators
   web

.. toctree::
   :maxdepth: 2
   :caption: Reference

   tide-json
   settings
   shortcuts

.. toctree::
   :maxdepth: 2
   :caption: Develop TIde itself

   building
   contributing
   credits
