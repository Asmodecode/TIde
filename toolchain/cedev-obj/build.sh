#!/bin/sh
# Builds cedev-obj (from the CE toolchain, LGPLv3), which lists the libraries a CE program's object
# uses for its startup code, with Emscripten for TIde: cedev-obj.js and .wasm, into the folder given.
#   git clone --depth 1 -b v15.0 https://github.com/CE-Programming/toolchain.git cedev
#   docker run --rm -v "$PWD:/w" -w /w -v tide-emcache:/emsdk/upstream/emscripten/cache \
#     emscripten/emsdk:3.1.74 sh toolchain/cedev-obj/build.sh cedev toolchain/cedev-obj/dist
set -eu
SRC="$(cd "$1/tools/cedev-obj" && pwd)"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
cd "$SRC"
emcc -O2 -std=c99 -Isrc -DNDEBUG -D_XOPEN_SOURCE=500 -DCEDEV_VERSION='"v15.0"' src/main.c src/elf_inspect.c \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s INVOKE_RUN=0 -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1 -s FORCE_FILESYSTEM=1 \
  -s ENVIRONMENT=web,worker -s EXPORTED_RUNTIME_METHODS=FS,callMain \
  -o "$OUT/cedev-obj.js"
