#!/bin/sh
# Builds Spasm.js and Spasm.wasm (into the folder given): spasm-ng (GPLv2), the TI-83 Plus,
# 84 Plus and 84 Plus CE assembler, compiled with Emscripten for TIde's web version and desktop
# builds. App signing (libgmp, OpenSSL) is left out. Run inside an Emscripten container:
#   git clone https://github.com/alberthdev/spasm-ng.git spasm
#   git -C spasm checkout 5f0786d38f064835be674d4b7df42969967bb73c
#   docker run --rm -v "$PWD:/w" -w /w emscripten/emsdk:3.1.74 sh toolchain/spasm/build.sh spasm toolchain/spasm/dist
set -eu
SRC="$1"
OUT="$2"
mkdir -p "$OUT"
cd "$SRC"
em++ -O2 -w -std=gnu++14 -DUSE_REUSABLES -DUNIXVER -DUSE_BUILTIN_FCREATE -DNO_APPSIGN \
  main.cpp opcodes.cpp pass_one.cpp pass_two.cpp utils.cpp export.cpp preop.cpp directive.cpp console.cpp \
  expand_buf.cpp hash.cpp list.cpp parser.cpp storage.cpp errors.cpp bitmap.cpp modp_ascii.cpp opcodes_ez80.cpp \
  -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=Spasm -s INVOKE_RUN=0 -s EXIT_RUNTIME=1 -s ALLOW_MEMORY_GROWTH=1 \
  -s ENVIRONMENT=web,worker -s FORCE_FILESYSTEM=1 -s EXPORTED_RUNTIME_METHODS=FS,callMain \
  -o "$OLDPWD/$OUT/Spasm.js"
cd "$OLDPWD"
cp "$SRC"/inc/*.inc "$OUT/"
