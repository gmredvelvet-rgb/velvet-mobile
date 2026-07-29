/**
 * Velvet Mobile — entry point and lifecycle controller.
 *
 * Builds every service, populates the service locator, and reconciles the
 * whole module against the device profile through the ServiceRegistry.
 * This is the only file with side effects at import time (the two
 * Hooks.once calls at the bottom).
 *
 * @module main
 */

import { HOOKS, MODES, MODULE_ID, SETTINGS } from "./core/constants.mjs";
import { LicenseClient } from "./license/license-client.mjs";
import { LicenseUI } from "./license/license-ui.mjs";
import { Logger } from "./core/logger.mjs";
import { Settings } from "./core/settings.mjs";
import { ServiceRegistry } from "./core/registry.mjs";
import { services } from "./core/services.mjs";
import { createAPI } from "./core/api.mjs";
import { DeviceProfiler } from "./responsive/device-profiler.mjs";
import { UIState } from "./responsive/ui-state.mjs";
import { ViewportService } from "./responsive/viewport.mjs";
import { GestureEngine } from "./gestures/engine.mjs";
import { KeyboardManager } from "./keyboard/keyboard-manager.mjs";
import { CanvasController } from "./canvas/canvas-controller.mjs";
import { SheetShell } from "./shell/sheet-shell.mjs";

class VelvetMobile {
  /** @type {ServiceRegistry} */
  #registry = new ServiceRegistry();

  /** @type {DeviceProfiler} */
  #profiler;

  /** @type {boolean} */
  #running = false;

  constructor() {
    this.#profiler = new DeviceProfiler({
      getMode: () => Settings.mode,
      onChange: (profile, old) => this.#onProfileChange(profile, old)
    });
    services.profiler = this.#profiler;

    // Lifecycle services, reconciled per profile. Order matters: gestures
    // must exist before the shell, which registers gestures.
    services.gestures = new GestureEngine();
    services.keyboard = new KeyboardManager();
    services.shell = new SheetShell();

    for (const service of [
      services.gestures,
      new ViewportService(),
      services.keyboard,
      new CanvasController(),
      services.shell
    ]) {
      this.#registry.add(service);
    }
  }

  /**
   * Called on the `init` hook. Foundry loads modules on the join, setup and
   * auth screens too, where there is no world, no actors and no canvas —
   * the shell must never touch those pages.
   */
  init() {
    if (game.view !== "game") return;
    Logger.info(`v${game.modules.get(MODULE_ID)?.version ?? "?"} starting`);
    Settings.register({
      onModeChange: () => {
        this.#syncNoCanvas({ promptReload: true });
        this.evaluate();
      },
      onMapChange: () => this.#syncNoCanvas({ promptReload: true }),
      onScaleChange: (value) => {
        if (this.#running) UIState.setScale(value);
      },
      onDebugChange: (value) => Logger.setDebug(value)
    });
    Logger.setDebug(Settings.debug);
    // init runs before Foundry creates the canvas, so this applies to the
    // current session without a reload (on mobile the
    // canvas never exists at all).
    this.#syncNoCanvas();
  }

  /**
   * Whether the mobile experience will activate on this client, computable
   * at init time (before the DeviceProfiler starts).
   * @returns {boolean}
   */
  #willActivate() {
    const mode = Settings.mode;
    if (mode === MODES.OFF) return false;
    if (mode === MODES.PHONE || mode === MODES.TABLET) return true;
    return window.matchMedia("(pointer: coarse) and (hover: none)").matches;
  }

  /**
   * Keep `core.noCanvas` in sync with the mobile mode. With the map turned
   * off, dropping the canvas entirely is a large memory and battery win on
   * phones. Only reverts a value this module set, so a user's own no-canvas
   * choice survives.
   * @param {object} [options]
   * @param {boolean} [options.promptReload]  Ask to reload (needed after setup).
   */
  #syncNoCanvas({ promptReload = false } = {}) {
    if (game.view !== "game") return;
    try {
      const current = game.settings.get("core", "noCanvas");
      const wanted = this.#willActivate() && !Settings.map;
      // The write is fire-and-forget by design (init must not block on it),
      // so its rejection is caught here rather than left unhandled.
      const write = (value) => game.settings.set("core", "noCanvas", value)
        ?.catch((err) => Logger.warn("Could not write core.noCanvas", err));
      if (wanted && !current) {
        write(true);
        Settings.managedNoCanvas = true;
      } else if (!wanted && current && Settings.managedNoCanvas) {
        write(false);
        Settings.managedNoCanvas = false;
      } else {
        return;
      }
      Logger.info(`core.noCanvas → ${wanted}`);
      if (promptReload) {
        (foundry.applications?.settings?.SettingsConfig ?? globalThis.SettingsConfig)
          ?.reloadConfirm?.({ world: false });
      }
    } catch (err) {
      Logger.warn("Could not sync core.noCanvas", err);
    }
  }

  /** Called on the `ready` hook. */
  async ready() {
    if (game.view !== "game") return;
    try {
      // The API exists regardless of licence state so other modules can
      // query it, but nothing activates until the world is licensed.
      const api = createAPI({ isActive: () => this.#running });
      game.modules.get(MODULE_ID).api = api;

      if (!await this.#checkLicense()) {
        Logger.info("Inactive — this world has no active licence");
        return;
      }

      this.evaluate();
      Hooks.callAll(HOOKS.READY, api);
      this.#reportStatus();
    } catch (err) {
      Logger.error("Startup failed", err);
      ui.notifications?.error(`Velvet Mobile: ${err?.message ?? err}`, { permanent: true });
    }
  }

  /**
   * Licence gate. Only the GM authorises: their client verifies the Patreon
   * subscription and writes the world flag that every other client reads,
   * so players never see a prompt and cannot enable the module themselves.
   * @returns {Promise<boolean>} Whether the module may run.
   */
  async #checkLicense() {
    if (game.user?.isGM) {
      const client = LicenseClient.instance;
      const licensed = await client.initialize();
      if (licensed) {
        await game.settings.set(MODULE_ID, SETTINGS.WORLD_LICENSED, true);
      } else if (!client.hasStoredCredentials) {
        // No credentials, or definitively rejected: ask for authorisation.
        // The stored flag is deliberately left alone — only a heartbeat
        // failure or an explicit release may revoke it.
        LicenseUI.show();
      }
      // Otherwise credentials exist but the server was unreachable: the
      // heartbeat recovers within a minute, so no prompt for an outage.
    }
    return Settings.worldLicensed;
  }

  /**
   * Say out loud — on the device itself — whether the mobile shell took
   * over, and why not when it did not. Silent when everything is working,
   * because a phone user has no console to check.
   */
  #reportStatus() {
    const profile = this.#profiler.profile;
    const active = this.#registry.isEnabled(services.shell.name);
    const version = game.modules.get(MODULE_ID)?.version ?? "?";
    Logger.info(`v${version} — shell ${active ? "active" : "INACTIVE"}`, profile);
    if (active) return;

    // Staying inactive on a real desktop is the correct outcome, not a
    // problem to announce. Only speak up when the device could host the
    // mobile UI, or when startup actually failed.
    const touchCapable = (navigator.maxTouchPoints ?? 0) > 0
      || window.matchMedia("(pointer: coarse)").matches;
    if (!touchCapable && !services.shell.lastError) return;

    let reason;
    if (services.shell.lastError) reason = `startup error — ${services.shell.lastError.message}`;
    else if (Settings.mode === MODES.OFF) reason = `Mobile Mode is "Off" in this world's settings`;
    else reason = `this client was detected as "${profile?.device ?? "unknown"}" (set Mobile Mode to "Force Phone")`;
    ui.notifications?.warn(`Velvet Mobile ${version}: mobile interface inactive — ${reason}.`, { permanent: true });
  }

  /**
   * Reconcile the running state against the `mode` setting. Handles live
   * switching between off and any active mode without a reload.
   */
  evaluate() {
    // The licence gate is checked here rather than only at startup, so no
    // code path (setting change, live authorisation) can bypass it.
    if (!Settings.worldLicensed) return this.deactivate();
    const off = Settings.mode === MODES.OFF;
    if (off && this.#running) return this.#stop();
    if (off) return;
    if (this.#running) return this.#profiler.refresh();
    this.#start();
  }

  /** Shut the mobile experience down (licence revoked, or mode off). */
  deactivate() {
    if (this.#running) this.#stop();
  }

  #start() {
    this.#running = true;
    UIState.setScale(Settings.uiScale);
    this.#profiler.start();
    Logger.info(`Active — device: ${this.#profiler.profile?.device}, input: ${this.#profiler.profile?.input}`);
  }

  #stop() {
    this.#running = false;
    this.#profiler.stop();
    this.#registry.disableAll();
    UIState.clear();
    Logger.info("Disabled on this client (mode: off)");
  }

  /**
   * @param {Readonly<object>} profile
   * @param {Readonly<object>|null} old
   */
  #onProfileChange(profile, old) {
    UIState.apply(profile);
    this.#registry.reconcile(profile);
    Hooks.callAll(HOOKS.DEVICE_CHANGED, profile, old);
  }
}

/**
 * Foundry loads module scripts on every page — join, setup, auth, stream —
 * not just the game. The in-method `game.view` guards cover the hooks, but
 * the safest module on those pages is one that never even constructs:
 * outside /game this file must be a complete no-op.
 */
const IS_GAME_PAGE = /\/game\/?$/.test(window.location.pathname);

if (IS_GAME_PAGE) {
  const controller = new VelvetMobile();
  Hooks.once("init", () => controller.init());
  Hooks.once("ready", () => controller.ready());
  // The GM authorising mid-session unlocks every connected client without
  // anyone reloading; the flag arrives here as a world-setting update.
  Hooks.on("updateSetting", (setting) => {
    if (setting.key !== `${MODULE_ID}.${SETTINGS.WORLD_LICENSED}`) return;
    if (setting.value === true || setting.value === "true") controller.evaluate();
    else controller.deactivate();
  });
} else {
  Logger.info(`Inactive on this page (${window.location.pathname})`);
}
