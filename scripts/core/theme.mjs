/**
 * Velvet Mobile — theme resolution.
 *
 * Carries the design language of the table's desktop sheet module onto the
 * phone. A group that plays D&D with the AAA sheet gets gold and Cinzel on
 * mobile; a Starfinder table running the cyberpunk sheet gets cyan on navy.
 * The alternative — one house style regardless — makes the phone look like a
 * different product from the sheet the same players use on a laptop.
 *
 * This module decides *which* theme and writes it to `<html>`. Everything it
 * means is CSS: styles/themes.css redefines the `--vm-*` tokens per theme.
 * No component reads the theme, so a theme can never change behaviour — only
 * how the same interface looks.
 *
 * Resolution order, most specific first:
 *   1. The `theme` setting, when the user picked one outright.
 *   2. The first active companion sheet module. Three of the four serve
 *      pf2e, so the system alone cannot tell them apart.
 *   3. The game system.
 *   4. The module's own look.
 *
 * @module core/theme
 */

import { ROOT_ATTRS, SETTINGS, MODULE_ID, THEMES, THEME_MODULES, THEME_SYSTEMS } from "./constants.mjs";
import { Logger } from "./logger.mjs";

export class Theme {
  /** @type {string} The theme currently written to <html>. */
  static #current = "";

  /**
   * Work out which theme applies right now.
   * @returns {string} One of THEMES, never AUTO.
   */
  static resolve() {
    const chosen = Theme.#setting;
    if (chosen && chosen !== THEMES.AUTO) return chosen;

    for (const { id, theme } of THEME_MODULES) {
      if (game.modules?.get(id)?.active) return theme;
    }

    return THEME_SYSTEMS[game.system?.id] ?? THEMES.VELVET;
  }

  /**
   * Write the resolved theme (and the raw system id) onto `<html>`.
   * Idempotent: safe to call on every settings change.
   */
  static apply() {
    const theme = Theme.resolve();
    const root = document.documentElement;
    root.setAttribute(ROOT_ATTRS.THEME, theme);
    root.setAttribute(ROOT_ATTRS.SYSTEM, game.system?.id ?? "");
    if (theme !== Theme.#current) {
      Theme.#current = theme;
      Logger.info(`Theme: ${theme}`);
      document.dispatchEvent(new CustomEvent("velvet-mobile:theme-changed", {
        detail: { theme, system: game.system?.id ?? "" }
      }));
    }
  }

  /** @returns {string} The theme in force. */
  static get current() {
    return Theme.#current || Theme.resolve();
  }

  /**
   * @returns {string} The stored setting, or AUTO before registration.
   *
   * Read defensively: the theme is applied on `ready`, and a world whose
   * settings failed to register should still get a usable interface rather
   * than an exception on the way to first paint.
   */
  static get #setting() {
    try {
      return game.settings.get(MODULE_ID, SETTINGS.THEME);
    } catch {
      return THEMES.AUTO;
    }
  }
}
