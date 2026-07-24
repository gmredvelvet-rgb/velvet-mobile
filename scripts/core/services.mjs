/**
 * Velvet Mobile — service locator.
 *
 * Populated once by `main.mjs` during startup. Components and engines import
 * this object instead of threading every dependency through constructors.
 * Nothing here is public API — external modules must go through
 * `game.modules.get("velvet-mobile").api`.
 *
 * @module core/services
 */

/**
 * @type {{
 *   profiler: import("../responsive/device-profiler.mjs").DeviceProfiler|null,
 *   gestures: import("../gestures/engine.mjs").GestureEngine|null,
 *   keyboard: import("../keyboard/keyboard-manager.mjs").KeyboardManager|null,
 *   shell:    import("../shell/sheet-shell.mjs").SheetShell|null
 * }}
 */
export const services = {
  profiler: null,
  gestures: null,
  keyboard: null,
  shell: null
};
