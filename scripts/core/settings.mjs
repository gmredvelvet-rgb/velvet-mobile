/**
 * Velvet Mobile — settings registration and typed access.
 * All settings are client-scoped: mobile experience is a per-device choice.
 * @module core/settings
 */

import {
  MODULE_ID, L10N, SETTINGS, MODES, USER_MODE_OVERRIDES,
  CHAT_MODES, MOVE_STYLES, STEP_SOUNDS, THEMES
} from "./constants.mjs";
import { Logger } from "./logger.mjs";
import { licenseMenuClass } from "../license/license-ui.mjs";
import { hubActive, isModuleLicensed } from "../license/license-hub.mjs";

export class Settings {
  /** @type {Set<string>} Per-player world settings already registered. */
  static #registeredUserModes = new Set();

  /** @type {((userId: string, value: string) => void)|null} */
  static #onUserModeChange = null;

  /**
   * Register every setting.
   * @param {object} callbacks                     Change handlers owned by the controller.
   * @param {(value: string) => void} callbacks.onModeChange
   * @param {(value: number) => void} callbacks.onScaleChange
   * @param {(value: boolean) => void} callbacks.onDebugChange
   */
  static register({ onModeChange, onUserModeChange, onMapChange, onScaleChange, onThemeChange, onDebugChange }) {
    const localize = (key) => `${L10N}.Settings.${key}`;
    this.#onUserModeChange = onUserModeChange;

    // World licence flag: written by the GM's client after Patreon auth,
    // read by every client to decide whether the module may run at all.
    game.settings.register(MODULE_ID, SETTINGS.WORLD_LICENSED, {
      scope: "world",
      config: false,
      type: Boolean,
      default: false
    });

    // GM-only entry point to connect, re-authorise or release the slot. With
    // Velvet License Hub active, the hub's menu is the one place for that.
    if (!hubActive()) game.settings.registerMenu(MODULE_ID, SETTINGS.LICENSE_MENU, {
      name: localize("License.Name"),
      label: localize("License.Label"),
      hint: localize("License.Hint"),
      icon: "fa-brands fa-patreon",
      type: licenseMenuClass(),
      restricted: true
    });

    game.settings.register(MODULE_ID, SETTINGS.MODE, {
      name: localize("Mode.Name"),
      hint: localize("Mode.Hint"),
      scope: "client",
      config: true,
      type: String,
      choices: {
        [MODES.AUTO]: localize("Mode.Auto"),
        [MODES.PHONE]: localize("Mode.Phone"),
        [MODES.TABLET]: localize("Mode.Tablet"),
        [MODES.OFF]: localize("Mode.Off")
      },
      default: MODES.AUTO,
      onChange: onModeChange
    });

    this.#registerOwnUserMode();

    /* Auto follows the table's own sheet module, then the game system — see
       core/theme.mjs. The explicit choices are for a table that runs one of
       these sheets but prefers the look of another. */
    game.settings.register(MODULE_ID, SETTINGS.THEME, {
      name: localize("Theme.Name"),
      hint: localize("Theme.Hint"),
      scope: "client",
      config: true,
      type: String,
      choices: {
        [THEMES.AUTO]: localize("Theme.Auto"),
        [THEMES.VELVET]: localize("Theme.Velvet"),
        [THEMES.AAA]: localize("Theme.Aaa"),
        [THEMES.MODERN_RPG]: localize("Theme.ModernRpg"),
        [THEMES.VELVET_PF2E]: localize("Theme.VelvetPf2e"),
        [THEMES.CYBER]: localize("Theme.Cyber"),
        [THEMES.HOPEFINDER]: localize("Theme.Hopefinder")
      },
      default: THEMES.AUTO,
      onChange: onThemeChange
    });

    game.settings.register(MODULE_ID, SETTINGS.MAP, {
      name: localize("Map.Name"),
      hint: localize("Map.Hint"),
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
      onChange: onMapChange
    });

    game.settings.register(MODULE_ID, SETTINGS.UI_SCALE, {
      name: localize("UiScale.Name"),
      hint: localize("UiScale.Hint"),
      scope: "client",
      config: true,
      type: Number,
      range: { min: 0.8, max: 1.4, step: 0.05 },
      default: 1,
      onChange: onScaleChange
    });

    game.settings.register(MODULE_ID, SETTINGS.CHAT_ON_MESSAGE, {
      name: localize("ChatOnMessage.Name"),
      hint: localize("ChatOnMessage.Hint"),
      scope: "client",
      config: true,
      type: String,
      choices: {
        [CHAT_MODES.ROLLS]: localize("ChatOnMessage.Rolls"),
        [CHAT_MODES.ALL]: localize("ChatOnMessage.All"),
        [CHAT_MODES.NONE]: localize("ChatOnMessage.None")
      },
      default: CHAT_MODES.ROLLS
    });

    game.settings.register(MODULE_ID, SETTINGS.CHAT_AUTO_HIDE, {
      name: localize("ChatAutoHide.Name"),
      hint: localize("ChatAutoHide.Hint"),
      scope: "client",
      config: true,
      type: Number,
      range: { min: 0, max: 30, step: 1 },
      default: 8
    });

    game.settings.register(MODULE_ID, SETTINGS.MOVE_STYLE, {
      name: localize("MoveStyle.Name"),
      hint: localize("MoveStyle.Hint"),
      scope: "client",
      config: true,
      type: String,
      choices: {
        [MOVE_STYLES.WEIGHTED]: localize("MoveStyle.Weighted"),
        [MOVE_STYLES.DIRECT]: localize("MoveStyle.Direct")
      },
      default: MOVE_STYLES.WEIGHTED
    });

    /* Two samples rather than one, alternated, so a walk does not become the
       same sound on repeat. Both default to empty — no audio ships yet — so
       footsteps are silent until pointed at a file. Clearing one field falls
       back to the other; clear both for silence. */
    game.settings.register(MODULE_ID, SETTINGS.STEP_SOUND, {
      name: localize("StepSound.Name"),
      hint: localize("StepSound.Hint"),
      scope: "client",
      config: true,
      type: String,
      default: STEP_SOUNDS.FIRST,
      filePicker: "audio"
    });

    game.settings.register(MODULE_ID, SETTINGS.STEP_SOUND_ALT, {
      name: localize("StepSoundAlt.Name"),
      hint: localize("StepSoundAlt.Hint"),
      scope: "client",
      config: true,
      type: String,
      default: STEP_SOUNDS.SECOND,
      filePicker: "audio"
    });

    game.settings.register(MODULE_ID, SETTINGS.STEP_VOLUME, {
      name: localize("StepVolume.Name"),
      hint: localize("StepVolume.Hint"),
      scope: "client",
      config: true,
      type: Number,
      range: { min: 0, max: 1, step: 0.05 },
      default: 0.6
    });

    // Internal: remembers that WE set core.noCanvas, so turning the module
    // off restores the user's own choice instead of clobbering it.
    game.settings.register(MODULE_ID, SETTINGS.MANAGED_NOCANVAS, {
      scope: "client",
      config: false,
      type: Boolean,
      default: false
    });

    game.settings.register(MODULE_ID, SETTINGS.DEBUG, {
      name: localize("Debug.Name"),
      hint: localize("Debug.Hint"),
      scope: "client",
      config: true,
      type: Boolean,
      default: false,
      onChange: onDebugChange
    });
  }

  /**
   * Register one GM-visible world selector per player, labelled with their
   * name. Runs at ready and on createUser: during init neither game.users nor
   * the translations exist yet.
   */
  static registerPlayerModes() {
    // v14 dropped i18n.format; localize interpolates instead.
    const format = (key, data) => typeof game.i18n.format === "function"
      ? game.i18n.format(key, data)
      : game.i18n.localize(key, data);
    for (const user of game.users?.contents ?? []) {
      if (!user?.id || user.isGM) continue;
      this.#registerUserMode(user.id, {
        name: format(`${L10N}.Settings.PlayerMode.Name`, { name: user.name }),
        hint: format(`${L10N}.Settings.PlayerMode.Hint`, { name: user.name })
      });
    }
  }

  /**
   * The connected player's own override must be readable at init, when
   * core.noCanvas is synced, so register it from the raw world data. The
   * label does not matter: players never see world settings.
   */
  static #registerOwnUserMode() {
    const own = game.data?.users?.find((user) => user._id === game.userId);
    if (!own || own.role >= CONST.USER_ROLES.ASSISTANT) return;
    this.#registerUserMode(own._id, { name: `${L10N}.Settings.PlayerMode.Name` });
  }

  /**
   * @param {string} userId
   * @param {{name: string, hint?: string}} labels
   */
  static #registerUserMode(userId, { name, hint }) {
    const key = this.userModeKey(userId);
    if (this.#registeredUserModes.has(key)) return;
    game.settings.register(MODULE_ID, key, {
      name,
      hint,
      scope: "world",
      config: true,
      restricted: true,
      type: String,
      choices: {
        [USER_MODE_OVERRIDES.OWN]: `${L10N}.Settings.PlayerMode.Own`,
        [MODES.PHONE]: `${L10N}.Settings.PlayerMode.Phone`,
        [MODES.TABLET]: `${L10N}.Settings.PlayerMode.Tablet`,
        [MODES.OFF]: `${L10N}.Settings.PlayerMode.Off`
      },
      default: USER_MODE_OVERRIDES.OWN,
      onChange: (value) => this.#onUserModeChange?.(userId, value)
    });
    this.#registeredUserModes.add(key);
  }

  /** @param {string} userId @returns {string} */
  static userModeKey(userId) {
    return `${SETTINGS.USER_MODE_PREFIX}${userId}`;
  }

  /** @returns {string} */
  static get mode() {
    const own = game.settings.get(MODULE_ID, SETTINGS.MODE);
    // game.user is still null during init; game.userId is not.
    const userId = game.user?.id ?? game.userId;
    if (!userId) return own;
    const key = this.userModeKey(userId);
    if (!this.#registeredUserModes.has(key)) return own;
    try {
      const override = game.settings.get(MODULE_ID, key);
      return override === USER_MODE_OVERRIDES.OWN ? own : override;
    } catch {
      return own;
    }
  }

  /**
   * Whether this world is licensed for Velvet Mobile: Velvet License Hub's
   * verdict once it has spoken for this world, the world flag until then — so a
   * patron who already paid is not locked out by updating. Every gate reads it
   * through here, `evaluate()` included.
   * @returns {boolean}
   */
  static get worldLicensed() {
    return isModuleLicensed(MODULE_ID);
  }

  /** @returns {string} One of THEMES; AUTO means "work it out" (core/theme.mjs). */
  static get theme() {
    return game.settings.get(MODULE_ID, SETTINGS.THEME);
  }

  /** @returns {boolean} Whether the game canvas stays available on mobile. */
  static get map() {
    return game.settings.get(MODULE_ID, SETTINGS.MAP);
  }

  /** @returns {number} */
  static get uiScale() {
    return game.settings.get(MODULE_ID, SETTINGS.UI_SCALE);
  }

  /** @returns {string} One of CHAT_MODES. */
  static get chatOnMessage() {
    return game.settings.get(MODULE_ID, SETTINGS.CHAT_ON_MESSAGE);
  }

  /** @returns {number} Seconds before an auto-opened chat panel hides (0 = never). */
  static get chatAutoHide() {
    return game.settings.get(MODULE_ID, SETTINGS.CHAT_AUTO_HIDE);
  }

  /** @returns {string} One of MOVE_STYLES. */
  static get moveStyle() {
    return game.settings.get(MODULE_ID, SETTINGS.MOVE_STYLE);
  }

  /** @returns {string[]} Footstep sounds to cycle through; empty when silent. */
  static get stepSounds() {
    return [
      game.settings.get(MODULE_ID, SETTINGS.STEP_SOUND),
      game.settings.get(MODULE_ID, SETTINGS.STEP_SOUND_ALT)
    ].filter((src) => typeof src === "string" && src.trim());
  }

  /** @returns {number} Footstep volume, 0 to 1. */
  static get stepVolume() {
    return game.settings.get(MODULE_ID, SETTINGS.STEP_VOLUME);
  }

  /** @returns {boolean} Whether this module is the one that enabled core.noCanvas. */
  static get managedNoCanvas() {
    return game.settings.get(MODULE_ID, SETTINGS.MANAGED_NOCANVAS);
  }

  /** @param {boolean} value */
  static set managedNoCanvas(value) {
    // A setter cannot return the promise, so the rejection has to be handled
    // here or it surfaces as an unhandled rejection in the console.
    game.settings.set(MODULE_ID, SETTINGS.MANAGED_NOCANVAS, value)
      ?.catch((err) => Logger.warn("Could not persist the managed-noCanvas flag", err));
  }

  /** @returns {boolean} */
  static get debug() {
    return game.settings.get(MODULE_ID, SETTINGS.DEBUG);
  }
}
