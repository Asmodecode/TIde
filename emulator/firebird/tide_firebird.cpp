// TIde's bridge to Firebird's core, for the calculator panel's TI-Nspire CX. Compiled to
// WebAssembly with the core's sources (see build.sh): the page writes boot1.img and
// flash.img into the emulated file system, starts the core, runs it a step at a time on its
// own timer, reads the screen, presses keys, and sends files over the emulated USB link.
// The core (Firebird) is GPLv3, and so is this file, which is built into it.
#include <cerrno>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>

#include <emscripten.h>

#include "core/cpu.h"
#include "core/debug.h"
#include "core/emu.h"
#include "core/flash.h"
#include "core/gdbstub.h"
#include "core/keypad.h"
#include "core/lcd.h"
#include "core/mem.h"
#include "core/mmu.h"
#include "core/schedule.h"
#include "core/usblink_queue.h"

// ── GUI callbacks, as the core's own emscripten/main.cpp defines them for the web build ──
void gui_do_stuff(bool) {}
void gui_debug_printf(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt); vprintf(fmt, ap); va_end(ap);
}
void gui_debug_vprintf(const char *fmt, va_list ap) { vprintf(fmt, ap); }
void gui_status_printf(const char *fmt, ...) {
    va_list ap; va_start(ap, fmt); gui_debug_vprintf(fmt, ap); va_end(ap);
}
void gui_perror(const char *msg) { gui_debug_printf("%s: %s\n", msg, strerror(errno)); }
void gui_debugger_entered_or_left(bool) {}
void gui_debugger_request_input(debug_input_cb callback) { if (callback) callback(""); }
void gui_putchar(char c) { putc(c, stdout); }
int gui_getchar() { return -1; }
void gui_set_busy(bool) {}
void gui_show_speed(double) {}
void gui_usblink_changed(bool) {}
void throttle_timer_off() {}
void throttle_timer_on() {}
void throttle_timer_wait(unsigned int) {}

// The core's own 100 Hz throttle event (defined in emu.cpp): pumps the USB link queue, so
// queued file transfers run while the emulator steps.
void throttle_interval_event(int index);

// Reports a file transfer's progress (0–100, or negative on error) to the page.
EM_JS(void, tide_fb_progress_js, (int p), { if (globalThis.tideFbProgress) globalThis.tideFbProgress(p); });
static void tide_fb_progress_cb(int progress, void *) { tide_fb_progress_js(progress); }

/** Turns the calculator off and on again: the reset the core's emu_loop does on start/reset. */
static void tide_reset() {
    memset(mem_areas[1].ptr, 0, mem_areas[1].size);
    memset(&arm, 0, sizeof arm);
    arm.control = 0x00050078;
    arm.cpsr_low28 = MODE_SVC | 0xC0;
    cpu_events &= EVENT_DEBUG_STEP;
    sched_reset();
    sched.items[SCHED_THROTTLE].clock = CLOCK_27M;
    sched.items[SCHED_THROTTLE].proc = throttle_interval_event;
    memory_reset();
    addr_cache_flush();
    sched_update_next_event(0);
    exiting = false;
}

extern "C" {

/** Boots the Nspire from boot1.img and flash.img, which the page writes into the FS first. */
EMSCRIPTEN_KEEPALIVE int fb_start() {
    path_boot1 = "boot1.img";
    path_flash = "flash.img";
    if (!emu_start(0, 0, NULL)) return 0;
    turbo_mode = true;
    gdbstub_reset();
    addr_cache_flush();
    sched_update_next_event(0);
    exiting = false;
    return 1;
}

/** Runs the emulator for a while: the loop body of the core's emscripten step(). */
EMSCRIPTEN_KEEPALIVE void fb_step() {
    int i = 1000;
    while (i--) {
        try {
        sched_process_pending_events();
        while (!exiting && cycle_count_delta < 0) {
            if (cpu_events & EVENT_RESET) { cpu_events &= ~EVENT_RESET; tide_reset(); break; }
            if (cpu_events & EVENT_SLEEP) { cycle_count_delta = 0; break; }
            if (cpu_events & (EVENT_FIQ | EVENT_IRQ)) {
                // Align PC in case the interrupt occurred immediately after a jump
                if (arm.cpsr_low28 & 0x20) arm.reg[15] &= ~1;
                else arm.reg[15] &= ~3;
                if (cpu_events & EVENT_WAITING) arm.reg[15] += 4; // Skip over wait instruction
                arm.reg[15] += 4;
                cpu_exception((cpu_events & EVENT_FIQ) ? EX_FIQ : EX_IRQ);
            }
            cpu_events &= ~EVENT_WAITING;
            if (arm.cpsr_low28 & 0x20) cpu_thumb_loop();
            else cpu_arm_loop();
        }
        } catch (emu_restart_exception &) {
            // return_to_loop(): a CPU exception (abort/undefined/error) redirected the
            // PC; keep stepping from the exception vector instead of aborting the wasm.
        }
    }
}

/** Draws the 320x240 screen into `dest` as RGBA (0xFF alpha), ready for an ImageData. */
EMSCRIPTEN_KEEPALIVE void fb_paint(uint32_t *dest) {
    static uint16_t buf[320 * 240];
    lcd_cx_draw_frame(buf);
    uint16_t *in = buf;
    for (int i = 320 * 240; i--;) {
        *dest++ = (((*in & 0xf800) >> 8) | ((*in & 0x07e0) << 5) | ((*in & 0x1f) << 19)) | 0xFF000000;
        in++;
    }
}

/** Presses or releases a key by its keypad matrix row (0–7) and column (0–10). */
EMSCRIPTEN_KEEPALIVE void fb_key(int row, int col, int down) {
    if (row < 0 || row >= KEYPAD_ROWS || col < 0 || col >= KEYPAD_COLS) return;
    keypad_set_key(row, col, down != 0);
    keypad_int_check();
}

/** Moves the touchpad: x and y are 0–1 (y up), contact/down say whether it is touched/pressed. */
EMSCRIPTEN_KEEPALIVE void fb_touch(float x, float y, int contact, int down) {
    touchpad_set_state(x, y, contact != 0, down != 0);
}

/** Turns the calculator off and on again, keeping the flash image. */
EMSCRIPTEN_KEEPALIVE void fb_reset() { tide_reset(); }

/** Queues a file to send to the calculator over the emulated USB link (remote path, e.g. /documents/X.tns). */
EMSCRIPTEN_KEEPALIVE void fb_send(const char *local, const char *remote) {
    usblink_queue_put_file(std::string(local), std::string(remote), tide_fb_progress_cb, nullptr);
    usblink_queue_do();
}

/** Whether any flash blocks changed since they were last saved. */
EMSCRIPTEN_KEEPALIVE int fb_flash_dirty() {
    for (int i = 0; i < 2048; i++) if (nand.nand_block_modified[i]) return 1;
    return 0;
}

/** Writes changed flash blocks back into flash.img in the FS, so the page can save them. */
EMSCRIPTEN_KEEPALIVE int fb_save_flash() { return flash_save_changes() ? 1 : 0; }

}

int main() { return 0; }
