/**
 * Velvet Mobile — CommandBar.
 *
 * The persistent bottom chrome: the actions a player reaches for during play,
 * each one tap away. The speed-dial it replaces cost two taps for everything
 * — open the dial, then choose — which is a poor trade for screen space that
 * a fixed bar can hold anyway.
 *
 * Slots are sized to the thumb (--vm-touch-target) and labelled, because an
 * unlabelled icon row is a memory test. Anything past the fourth action moves
 * into an overflow popover rather than shrinking the row.
 *
 * @module shell/command-bar
 */

import { CLS, L10N } from "../core/constants.mjs";
import { VelvetComponent } from "../components/component.mjs";

/**
 * Actions shown inline; the rest go to the overflow menu. Five slots is what
 * fits above a 360px viewport at the minimum touch target without crowding.
 */
const INLINE_SLOTS = 5;

export class CommandBar extends VelvetComponent {
  /**
   * @type {{name: string, icon: string, label: string, onTap: () => void}[]}
   * In priority order — the first INLINE_SLOTS get a slot of their own.
   */
  #actions;

  /** @type {HTMLElement|null} Open overflow popover. */
  #overflow = null;

  /** @type {AbortController|null} Listeners tied to the open popover. */
  #overflowAbort = null;

  /** @param {object} options @param {object[]} options.actions */
  constructor({ actions }) {
    super();
    this.#actions = actions;
  }

  /** @override @returns {HTMLElement} */
  build() {
    const el = VelvetComponent.el;
    const inline = this.#actions.length > INLINE_SLOTS + 1
      ? this.#actions.slice(0, INLINE_SLOTS)
      : this.#actions;

    const slots = inline.map((action) => this.#buildSlot(action));

    if (inline.length < this.#actions.length) {
      const more = this.#buildSlot({
        name: "more",
        icon: "fa-solid fa-ellipsis",
        label: game.i18n.localize(`${L10N}.Shell.More`),
        onTap: () => this.#toggleOverflow()
      });
      slots.push(more);
    }

    return el("nav", {
      cls: `${CLS}-cmd`,
      attrs: { "aria-label": game.i18n.localize(`${L10N}.Shell.Commands`) },
      children: slots
    });
  }

  /**
   * @param {{name: string, icon: string, label: string, onTap: () => void}} action
   * @returns {HTMLElement}
   */
  #buildSlot(action) {
    const el = VelvetComponent.el;
    const btn = el("button", {
      cls: `${CLS}-cmd-btn`,
      attrs: { type: "button", "data-action": action.name, "aria-label": action.label },
      children: [
        el("span", {
          cls: `${CLS}-cmd-icon`,
          children: [VelvetComponent.icon(action.icon), el("span", { cls: `${CLS}-cmd-dot`, attrs: { hidden: "" } })]
        }),
        el("span", { cls: `${CLS}-cmd-label`, text: action.label })
      ]
    });
    this.listen(btn, "click", () => {
      // Any command other than the overflow toggle closes an open popover:
      // acting from the menu should leave the menu behind.
      if (action.name !== "more") this.#closeOverflow();
      action.onTap();
    });
    return btn;
  }

  /* -- State ---------------------------------------------------------------- */

  /**
   * Light a command up while its screen or mode is active.
   * @param {string} name
   * @param {boolean} on
   */
  setActive(name, on) {
    this.#slot(name)?.classList.toggle(`${CLS}-active`, on);
    // A command living in the overflow lights the overflow button instead, so
    // an active mode is never invisible.
    if (!this.#slot(name)) this.#slot("more")?.classList.toggle(`${CLS}-active`, on);
    this.#overflowRow(name)?.classList.toggle(`${CLS}-active`, on);
  }

  /**
   * Show or clear an unread marker on a command.
   * @param {string} name
   * @param {boolean} on
   */
  setBadge(name, on) {
    const dot = (this.#slot(name) ?? this.#slot("more"))?.querySelector(`.${CLS}-cmd-dot`);
    if (!dot) return;
    if (on) dot.removeAttribute("hidden");
    else dot.setAttribute("hidden", "");
  }

  /** @override */
  destroy() {
    this.#closeOverflow();
    super.destroy();
  }

  /* -- Overflow ------------------------------------------------------------- */

  #toggleOverflow() {
    if (this.#overflow) return void this.#closeOverflow();
    const el = VelvetComponent.el;
    const rows = this.#actions.slice(INLINE_SLOTS).map((action) => {
      const row = el("button", {
        cls: `${CLS}-cmd-row`,
        attrs: { type: "button", "data-action": action.name },
        children: [VelvetComponent.icon(action.icon), el("span", { text: action.label })]
      });
      row.addEventListener("click", () => {
        this.#closeOverflow();
        action.onTap();
      });
      return row;
    });

    this.#overflow = el("div", { cls: `${CLS}-cmd-overflow`, children: rows });
    this.element.append(this.#overflow);
    this.#slot("more")?.setAttribute("aria-expanded", "true");

    // Bound on the next frame: the tap that opened the menu is still
    // travelling, and would otherwise close it again immediately.
    this.#overflowAbort = new AbortController();
    const { signal } = this.#overflowAbort;
    requestAnimationFrame(() => {
      if (signal.aborted) return;
      document.addEventListener("pointerdown", (event) => {
        if (!this.element?.contains(event.target)) this.#closeOverflow();
      }, { signal });
    });
  }

  #closeOverflow() {
    this.#overflowAbort?.abort();
    this.#overflowAbort = null;
    this.#overflow?.remove();
    this.#overflow = null;
    this.#slot("more")?.setAttribute("aria-expanded", "false");
  }

  /** @param {string} name @returns {HTMLElement|null} */
  #slot(name) {
    return this.element?.querySelector(`.${CLS}-cmd-btn[data-action="${name}"]`) ?? null;
  }

  /** @param {string} name @returns {HTMLElement|null} */
  #overflowRow(name) {
    return this.#overflow?.querySelector(`[data-action="${name}"]`) ?? null;
  }
}
