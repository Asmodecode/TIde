#!/bin/sh
# Builds ez80-clang (CE-Programming's LLVM fork, LLVM 19.1, Apache-2.0 with LLVM exceptions)
# with Emscripten for TIde: clang.js and clang.wasm, into the folder given. Only the Z80/eZ80 backend
# and Clang are built. Run inside an Emscripten container:
#   docker run --rm -v "$PWD:/w" -w /w \
#     -v tide-llvm:/build -v tide-emcache:/emsdk/upstream/emscripten/cache \
#     emscripten/emsdk:3.1.74 sh toolchain/clang/build.sh toolchain/clang/dist
#
# It takes a long time (LLVM's build tools natively first, then Clang for WebAssembly). Everything
# happens in /build, a Docker volume: the source is cloned there from GitHub, and the build stays
# there, so a second run only rebuilds what changed. JOBS sets how many files compile at once; each
# can take over a gigabyte of memory, so it's lower than the CPU count by default.
set -eu
REPO=https://github.com/CE-Programming/llvm-project.git
COMMIT=ef28e9c54cd1333a6091ab2ffbd315b465fc5090   # the ez80-clang in CE C Toolchain v15.0 (its libraries are built with it)
OUT="$(mkdir -p "$1" && cd "$1" && pwd)"
JOBS="${JOBS:-5}"
WORK=/build
mkdir -p "$WORK"
if [ "$(cat "$WORK/src.commit" 2>/dev/null)" != "$COMMIT" ]; then
  rm -rf "$WORK/src" "$WORK/native" "$WORK/wasm"
  git init -q "$WORK/src"
  git -C "$WORK/src" fetch -q --depth 1 "$REPO" "$COMMIT"
  git -C "$WORK/src" sparse-checkout set cmake third-party llvm clang
  git -C "$WORK/src" checkout -q FETCH_HEAD
  echo "$COMMIT" > "$WORK/src.commit"
fi

COMMON="-DLLVM_TARGETS_TO_BUILD= -DLLVM_EXPERIMENTAL_TARGETS_TO_BUILD=Z80 -DLLVM_ENABLE_PROJECTS=clang \
  -DLLVM_INCLUDE_EXAMPLES=OFF -DLLVM_INCLUDE_TESTS=OFF -DLLVM_INCLUDE_BENCHMARKS=OFF -DLLVM_INCLUDE_DOCS=OFF \
  -DLLVM_ENABLE_ZLIB=OFF -DLLVM_ENABLE_ZSTD=OFF -DLLVM_ENABLE_LIBXML2=OFF -DLLVM_ENABLE_TERMINFO=OFF -DLLVM_ENABLE_LIBEDIT=OFF \
  -DCLANG_ENABLE_ARCMT=OFF -DCLANG_ENABLE_STATIC_ANALYZER=OFF"

# 1. LLVM's and Clang's table generators, for this machine: the WebAssembly build runs them.
if [ ! -x "$WORK/native/bin/clang-tblgen" ]; then
  cmake -S "$WORK/src/llvm" -B "$WORK/native" -DCMAKE_BUILD_TYPE=Release $COMMON
  make -C "$WORK/native" -j"$JOBS" llvm-tblgen clang-tblgen
fi

# 2. Clang for WebAssembly, with eZ80 as its default target.
if [ ! -f "$WORK/wasm/Makefile" ]; then
  LINK="-s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=Clang -s INVOKE_RUN=0 -s EXIT_RUNTIME=1 -s FORCE_FILESYSTEM=1 \
    -s ENVIRONMENT=web,worker -s EXPORTED_RUNTIME_METHODS=FS,callMain \
    -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=64MB -s MAXIMUM_MEMORY=2GB -s STACK_SIZE=8MB"
  emcmake cmake -S "$WORK/src/llvm" -B "$WORK/wasm" -DCMAKE_BUILD_TYPE=MinSizeRel $COMMON \
    -DLLVM_TARGET_ARCH=ez80 -DLLVM_DEFAULT_TARGET_TRIPLE=ez80-none-elf -DLLVM_HOST_TRIPLE=wasm32-unknown-emscripten \
    -DLLVM_TABLEGEN="$WORK/native/bin/llvm-tblgen" -DCLANG_TABLEGEN="$WORK/native/bin/clang-tblgen" \
    -DLLVM_ENABLE_THREADS=OFF -DLLVM_ENABLE_PIC=OFF -DLLVM_BUILD_TOOLS=OFF -DLLVM_BUILD_UTILS=OFF \
    -DCLANG_BUILD_TOOLS=ON -DCLANG_ENABLE_CLANGD=OFF -DCLANG_PLUGIN_SUPPORT=OFF \
    -DCMAKE_EXE_LINKER_FLAGS="$LINK"
fi
make -C "$WORK/wasm" -j"$JOBS" clang
# Emscripten names it clang.js (a link to clang.js-<version>).
cp -L "$WORK/wasm/bin/clang.js" "$OUT/clang.js"
cp "$WORK/wasm/bin/clang.wasm" "$OUT/clang.wasm"
ls -la "$OUT"
