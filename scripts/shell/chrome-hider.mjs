/**
 * Velvet Mobile — ChromeHider.
 *
 * Hides Foundry's own interface while the mobile shell owns the screen.
 *
 * Rather than naming DOM ids (`#players`, `#ui-left`, …), this asks Foundry
 * where its interface actually lives, through the `ui.*` application
 * singletons. Those names are part of the public API and have been stable
 * for many major versions, whereas the DOM ids and their nesting are
 * internal markup that has already moved once inside v13 — which is exactly
 * how the players list ended up floating over the mobile UI.
 *
 * Foundry's UI applications re-render on their own (scene changes, user
 * connects, combat updates), replacing their elements. Hiding is therefore
 * re-applied after every application render rather than done once.
 *
 * @module shell/chrome-hider
 */

import { Logger } from "../core/logger.mjs";

/**
 * `ui` singletons that make up the desktop interface. Anything absent on a
 * given version or view is skipped, so this list may safely name keys that
 * only exist in some releases.
 *
 * Deliberately excluded: `notifications` (the only channel left to report
 * errors on a phone), and `chat` and `combat` (the shell hosts Foundry's
 * real chat log and encounter tracker inside its own panels — hiding them
 * here would win over the panel's own styling and show an empty sheet).
 * Both live inside the sidebar, which is hidden, so they stay out of sight
 * for as long as the shell is not borrowing them.
 */
const CHROME = Object.freeze([
  "players", "nav", "controls", "hotbar", "sidebar",
  "webrtc", "pause", "menu", "actors"
]);

/** Marker class; the actual `display: none` lives in shell.css. */
const HIDDEN_CLS = "vm-chrome-hidden";

export class ChromeHider {
  /** @type {Set<HTMLElement>} Elements currently hidden by us. */
  #hidden = new Set();

  /** @type {[string, number][]} Hook handles for symmetric teardown. */
  #hooks = [];

  /** @type {boolean} */
  #active = false;

  /** Hide Foundry's interface and keep it hidden across re-renders. */
  enable() {
    if (this.#active) return;
    this.#active = true;
    this.#apply();
    // Both generations: v14 still ships ApplicationV1, and core UI is mixed.
    for (const hook of ["renderApplicationV2", "renderApplication"]) {
      this.#hooks.push([hook, Hooks.on(hook, () => this.#apply())]);
    }
  }

  /** Restore every element we hid. Idempotent. */
  disable() {
    this.#active = false;
    for (const [name, id] of this.#hooks) Hooks.off(name, id);
    this.#hooks.length = 0;
    for (const element of this.#hidden) element.classList.remove(HIDDEN_CLS);
    this.#hidden.clear();
  }

  /* -- Internals ---------------------------------------------------------- */

  #apply() {
    if (!this.#active) return;
    for (const key of CHROME) {
      const element = ChromeHider.#elementOf(globalThis.ui?.[key]);
      if (!element || element.classList.contains(HIDDEN_CLS)) continue;
      element.classList.add(HIDDEN_CLS);
      this.#hidden.add(element);
    }
    // Elements replaced by a re-render are no longer in the document; drop
    // them so the set cannot grow without bound over a long session.
    for (const element of this.#hidden) {
      if (!element.isConnected) this.#hidden.delete(element);
    }
  }

  /**
   * AppV1 exposes a jQuery object, AppV2 an HTMLElement.
   * @param {object|null} app
   * @returns {HTMLElement|null}
   */
  static #elementOf(app) {
    try {
      const element = app?.element;
      if (!element) return null;
      if (element instanceof HTMLElement) return element;
      return element[0] instanceof HTMLElement ? element[0] : null;
    } catch (err) {
      Logger.debug("Could not read a UI element", err);
      return null;
    }
  }
}
