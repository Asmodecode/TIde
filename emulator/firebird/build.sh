#!/bin/sh
# Builds firebird.js and firebird.wasm into dist/, which TIde builds into the app: Firebird's
# core (the TI-Nspire emulator, the master snapshot dist/SOURCE.txt describes) with TIde's
# bridge, tide_firebird.cpp, in place of the core's own emscripten/main.cpp.
# Run with Emscripten installed, then commit dist/:
#   sh emulator/firebird/build.sh <firebird checkout> emulator/firebird/dist
set -eu
SRC="$1"
OUT="$2"
HERE="$(dirname "$0")"
BUILD="$(mktemp -d "${TMPDIR:-/tmp}/tide-firebird.XXXXXX")"
trap 'rm -rf "$BUILD"' EXIT
mkdir -p "$OUT" "$BUILD"

COMMON="-O3 -w -I$SRC -I$SRC/core/gif-h \
  -sUSE_ZLIB=1 -fwasm-exceptions -sINVOKE_RUN=0 -sASSERTIONS=0 \
  -sALLOW_MEMORY_GROWTH=1 -sENVIRONMENT=web -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=FirebirdEmu \
  -sEXPORTED_FUNCTIONS=_main,_malloc,_free,_fb_start,_fb_step,_fb_paint,_fb_key,_fb_touch,_fb_reset,_fb_send,_fb_flash_dirty,_fb_save_flash \
  -sEXPORTED_RUNTIME_METHODS=FS,HEAPU8,ccall,cwrap,UTF8ToString"

# C sources in C mode, C++ sources in C++ mode (as the core's emscripten/Makefile does).
for f in armsnippets_loader.c asmcode.c casplus.c des.c disasm.c gdbstub.c interrupt.c lcd.c \
         link.c mem.c misc.c mmu.c schedule.c serial.c sha256.c usb.c usblink.c os/os-emscripten.c; do
  emcc $COMMON -std=gnu11 -c "$SRC/core/$f" -o "$BUILD/$(basename "$f" .c).o"
done
for f in arm_interpreter.cpp coproc.cpp cpu.cpp cx2.cpp debug.cpp emu.cpp fieldparser.cpp flash.cpp \
         gif.cpp keypad.cpp thumb_interpreter.cpp usb_cx2.cpp usblink_cx2.cpp usblink_queue.cpp; do
  em++ $COMMON -std=gnu++11 -c "$SRC/core/$f" -o "$BUILD/$(basename "$f" .cpp).o"
done
em++ $COMMON -std=gnu++11 -c "$HERE/tide_firebird.cpp" -o "$BUILD/tide_firebird.o"

em++ $COMMON "$BUILD"/*.o -o "$OUT/firebird.js"
