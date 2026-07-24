/**
 * Velvet Mobile — settings registration and typed access.
 * All settings are client-scoped: mobile experience is a per-device choice.
 * @module core/settings
 */

import { MODULE_ID, L10N, SETTINGS, MODES, CHAT_MODES } from "./constants.mjs";
import { LicenseMenu } from "../license/license-ui.mjs";

export class Settings {
  /**
   * Register every setting.
   * @param {object} callbacks                     Change handlers owned by the controller.
   * @param {(value: string) => void} callbacks.onModeChange
   * @param {(value: number) => void} callbacks.onScaleChange
   * @param {(value: boolean) => void} callbacks.onDebugChange
   */
  static register({ onModeChange, onMapChange, onScaleChange, onDebugChange }) {
    const localize = (key) => `${L10N}.Settings.${key}`;

    // World licence flag: written by the GM's client after Patreon auth,
    // read by every client to decide whether the module may run at all.
    game.settings.register(MODULE_ID, SETTINGS.WORLD_LICENSED, {
      scope: "world",
      config: false,
      type: Boolean,
      default: false
    });

    // GM-only entry point to connect, re-authorise or release the slot.
    game.settings.registerMenu(MODULE_ID, SETTINGS.LICENSE_MENU, {
      name: localize("License.Name"),
      label: localize("License.Label"),
      hint: localize("License.Hint"),
      icon: "fa-brands fa-patreon",
      type: LicenseMenu,
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

  /** @returns {string} */
  static get mode() {
    return game.settings.get(MODULE_ID, SETTINGS.MODE);
  }

  /** @returns {boolean} Whether the GM has activated a licence for this world. */
  static get worldLicensed() {
    return game.settings.get(MODULE_ID, SETTINGS.WORLD_LICENSED) === true;
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

  /** @returns {boolean} Whether this module is the one that enabled core.noCanvas. */
  static get managedNoCanvas() {
    return game.settings.get(MODULE_ID, SETTINGS.MANAGED_NOCANVAS);
  }

  /** @param {boolean} value */
  static set managedNoCanvas(value) {
    game.settings.set(MODULE_ID, SETTINGS.MANAGED_NOCANVAS, value);
  }

  /** @returns {boolean} */
  static get debug() {
    return game.settings.get(MODULE_ID, SETTINGS.DEBUG);
  }
}
