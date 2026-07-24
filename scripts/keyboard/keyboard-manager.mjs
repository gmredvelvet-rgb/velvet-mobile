/**
 * Velvet Mobile — KeyboardManager.
 *
 * The anti-virtual-keyboard system. visualViewport alone is not a keyboard
 * detector (browser chrome also resizes it), so keyboard state is inferred
 * from BOTH signals: a large visual-viewport inset AND an editable element
 * holding focus.
 *
 * Outputs:
 *  - `data-vm-keyboard="open"` on <html> (CSS hides mobile chrome, anchors
 *    sheets to --vm-vvh which UIState keeps in sync)
 *  - the focused editable is kept visible inside its scroll container
 *
 * @module keyboard/keyboard-manager
 */

import { DEVICES, KEYBOARD_MIN_INSET, ROOT_ATTRS } from "../core/constants.mjs";

/** Delay before ensuring visibility, letting the keyboard animation settle. */
const SETTLE_MS = 250;

export class KeyboardManager {
  /** @type {string} */
  name = "keyboard";

  /** @type {AbortController|null} */
  #abort = null;

  /** @type {number|null} */
  #settleTimer = null;

  /** @param {object} profile @returns {boolean} */
  shouldEnable(profile) {
    return profile.device !== DEVICES.DESKTOP;
  }

  enable() {
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    document.addEventListener("focusin", () => this.#update(), { signal });
    document.addEventListener("focusout", () => this.#update(), { signal });
    window.visualViewport?.addEventListener("resize", () => this.#update(), { signal });
  }

  disable() {
    this.#abort?.abort();
    this.#abort = null;
    if (this.#settleTimer) clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
    document.documentElement.removeAttribute(ROOT_ATTRS.KEYBOARD);
  }

  /** @returns {boolean} */
  get isOpen() {
    return document.documentElement.getAttribute(ROOT_ATTRS.KEYBOARD) === "open";
  }

  #update() {
    const inset = window.innerHeight - (window.visualViewport?.height ?? window.innerHeight);
    const editable = KeyboardManager.#editableFocused();
    const open = inset >= KEYBOARD_MIN_INSET && editable !== null;

    const root = document.documentElement;
    if (open) root.setAttribute(ROOT_ATTRS.KEYBOARD, "open");
    else root.removeAttribute(ROOT_ATTRS.KEYBOARD);

    if (open && editable) {
      if (this.#settleTimer) clearTimeout(this.#settleTimer);
      this.#settleTimer = setTimeout(() => {
        this.#settleTimer = null;
        // Re-check: focus may have moved during the settle window.
        KeyboardManager.#editableFocused()?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, SETTLE_MS);
    }
  }

  /** @returns {HTMLElement|null} The focused editable element, if any. */
  static #editableFocused() {
    const el = document.activeElement;
    if (!el) return null;
    const editable = el.matches?.("input, textarea, select, [contenteditable=''], [contenteditable='true']");
    return editable ? el : null;
  }
}
