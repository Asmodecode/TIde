## TIde 1.6.1-web

A patch for the web version only, at https://xsamuraicoder.github.io/TIde/. The desktop app stays at 1.6.0 and doesn't update for this.

- **C in the browser:** the web version now has the C compiler (ez80-clang, built for WebAssembly), kept in the repository, so C projects build in the browser.
- **Known limit:** this compiler is ez80-clang from LLVM 15, an older one than the CE C Toolchain v15.0 uses (LLVM 19). Simple programs build and run; some programs produce an instruction the assembler rejects (`lea hl, iy`). Those still build in the desktop app with the CE toolchain installed.
- Everything in TIde 1.6.0 is here too.
