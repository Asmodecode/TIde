#!/bin/sh
# Builds the CE toolchain's GNU assembler, linker and objcopy (z80-none-elf binutils, GPLv3, from
# CE-Programming's binutils-gdb fork) with Emscripten, for TIde: as.js, ld.js and objcopy.js, each
# with its .wasm, into the folder given. Run inside an Emscripten container:
#   docker run --rm -v "$PWD:/w" -w /w \
#     -v tide-binutils:/build -v tide-emcache:/emsdk/upstream/emscripten/cache \
#     emscripten/emsdk:3.1.74 sh toolchain/binutils/build.sh toolchain/binutils/dist
#
# Speed: everything happens in /build, a Docker volume. The source is cloned there from GitHub rather
# than copied from the host (on Windows and macOS, reading the host's files from a container is many
# times slower), the build stays there between runs so a second run only rebuilds what changed, and
# tide-emcache keeps Emscripten's system libraries instead of making them again.
set -eu
# A git checkout has no generated parsers (the release tarballs do), so bison and flex (with m4) make them.
if ! command -v bison >/dev/null || ! command -v flex >/dev/null || ! command -v m4 >/dev/null; then
  apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq bison flex m4 >/dev/null
fi
REPO=https://github.com/CE-Programming/binutils-gdb.git
COMMIT=f2b9549659daf5801b89bc641f9ec22227558319   # binutils-2_47-cedev
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
WORK=/build
mkdir -p "$WORK"
if [ "$(cat "$WORK/src.commit" 2>/dev/null)" != "$COMMIT" ]; then
  rm -rf "$WORK/src" "$WORK/obj"
  git init -q "$WORK/src"
  git -C "$WORK/src" fetch -q --depth 1 "$REPO" "$COMMIT"
  git -C "$WORK/src" checkout -q FETCH_HEAD
  echo "$COMMIT" > "$WORK/src.commit"
fi
mkdir -p "$WORK/obj"
cd "$WORK/obj"
# Emscripten's libc has psignal, but configure's link test can't tell, and libiberty's own copy clashes.
export ac_cv_func_psignal=yes
# Programs the build makes and runs itself (such as bfd's doc generator) are for this machine, not WebAssembly.
export CC_FOR_BUILD=gcc CXX_FOR_BUILD=g++
if [ ! -f Makefile ]; then
  # Configure as for any host; configure's test programs run under Node.
  emconfigure "$WORK/src/configure" --target=z80-none-elf --with-zstd=no --without-zlib --disable-nls --disable-plugins \
    --disable-shared --enable-static --disable-gdb --disable-gdbserver --disable-sim --disable-gprof --disable-gprofng \
    --disable-readline --disable-libdecnumber --without-python --without-guile --disable-werror --disable-source-highlight \
    --without-debuginfod MAKEINFO=true
fi
# On the command line, so it reaches every sub-make (bfd's doc generator, chew, runs during the build).
NATIVE="CC_FOR_BUILD=gcc CXX_FOR_BUILD=g++ M4=m4"
rm -f bfd/doc/chew bfd/doc/chew.stamp bfd/doc/chew.wasm   # a WebAssembly chew from an earlier run
# A folder configured before bison and flex were installed thinks they're missing: configure it again.
for d in binutils ld gas; do
  if grep -qE "missing (flex|bison|lex|yacc)" "$d/config.status" 2>/dev/null; then rm -rf "$d"; fi
done
emmake make -j"$(nproc)" configure-zlib configure-libiberty configure-libsframe configure-bfd configure-opcodes configure-libctf \
  configure-gas configure-ld configure-binutils MAKEINFO=true $NATIVE
# The programs themselves, as ES modules the page can load and run more than once.
WASM="-s MODULARIZE=1 -s EXPORT_ES6=1 -s INVOKE_RUN=0 -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1 -s FORCE_FILESYSTEM=1 -s ENVIRONMENT=web,worker -s EXPORTED_RUNTIME_METHODS=FS,callMain"
emmake make -j"$(nproc)" all-gas all-ld MAKEINFO=true LDFLAGS="$WASM" $NATIVE
# Only objcopy from binutils/: the rest (ar, readelf, windres…) isn't needed, and some need generated parsers.
emmake make -C binutils -j"$(nproc)" objcopy MAKEINFO=true LDFLAGS="$WASM" $NATIVE
cp gas/as-new "$OUT/as.js";            cp gas/as-new.wasm "$OUT/as.wasm"
cp ld/ld-new "$OUT/ld.js";             cp ld/ld-new.wasm "$OUT/ld.wasm"
cp binutils/objcopy "$OUT/objcopy.js"; cp binutils/objcopy.wasm "$OUT/objcopy.wasm"
# binutils builds with debug info, which would only make the downloads bigger.
for t in as ld objcopy; do /emsdk/upstream/bin/wasm-opt --strip-debug --strip-producers "$OUT/$t.wasm" -o "$OUT/$t.wasm"; done
