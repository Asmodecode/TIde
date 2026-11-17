#!/bin/sh
# Builds convbin (BSD 3-clause, by Matt Waltz), which makes .8xp files from the linker's output, with
# Emscripten for TIde: convbin.js and convbin.wasm, into the folder given. Run inside an Emscripten container:
#   git clone https://github.com/mateoconlechuga/convbin.git convbin
#   git -C convbin checkout ba4e4a4ee4be8c86ec7ed48f156a98fcf696536c
#   git -C convbin submodule update --init src/deps/zx
#   docker run --rm -v "$PWD:/w" -w /w -v tide-emcache:/emsdk/upstream/emscripten/cache \
#     emscripten/emsdk:3.1.74 sh toolchain/convbin/build.sh convbin toolchain/convbin/dist
set -eu
SRC="$(cd "$1" && pwd)"
OUT="$(mkdir -p "$2" && cd "$2" && pwd)"
cd "$SRC"
emcc -O2 -std=c89 -DNDEBUG -DLOG_BUILD_LEVEL=3 -D_LARGEFILE64_SOURCE=1 -DPRGM_NAME='"convbin"' -DVERSION_STRING='"ba4e4a4e"' \
  src/main.c src/convert.c src/input.c src/output.c src/compress.c src/extract.c src/options.c src/ti8x.c src/elf.c src/log.c \
  src/asm/zx7_decompressor.c src/asm/zx0_decompressor.c src/asm/extractor.c \
  src/deps/miniz/miniz.c src/deps/zx/zx7/compress.c src/deps/zx/zx7/optimize.c src/deps/zx/zx0/compress.c src/deps/zx/zx0/optimize.c \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s INVOKE_RUN=0 -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1 -s FORCE_FILESYSTEM=1 \
  -s ENVIRONMENT=web,worker -s EXPORTED_RUNTIME_METHODS=FS,callMain \
  -o "$OUT/convbin.js"
