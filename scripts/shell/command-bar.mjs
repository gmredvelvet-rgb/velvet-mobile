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
 * Reserve the fifth slot for overflow when more than five actions exist.
 */
const INLINE_SLOTS = 4;

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

  #active = new Set();
  #badges = new Set();

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
      more.setAttribute("aria-haspopup", "menu");
      more.setAttribute("aria-expanded", "false");
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
      attrs: { type: "button", "data-action": action.name, "aria-label": action.label, title: action.label },
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
    on ? this.#active.add(name) : this.#active.delete(name);
    this.#syncState();
  }

  /**
   * Show or clear an unread marker on a command.
   * @param {string} name
   * @param {boolean} on
   */
  setBadge(name, on) {
    on ? this.#badges.add(name) : this.#badges.delete(name);
    this.#syncState();
  }

  #syncState() {
    for (const action of this.#actions) {
      const active = this.#active.has(action.name);
      const slot = this.#slot(action.name);
      slot?.classList.toggle(`${CLS}-active`, active);
      slot?.setAttribute("aria-pressed", String(active));
      const row = this.#overflowRow(action.name);
      row?.classList.toggle(`${CLS}-active`, active);
      const badge = this.#badges.has(action.name);
      for (const node of [slot, row]) {
        const dot = node?.querySelector(`.${CLS}-cmd-dot`);
        if (dot) dot.hidden = !badge;
      }
    }
    const hidden = this.#actions.filter((action) => !this.#slot(action.name));
    this.#slot("more")?.classList.toggle(`${CLS}-active`, hidden.some((a) => this.#active.has(a.name)));
    const dot = this.#slot("more")?.querySelector(`.${CLS}-cmd-dot`);
    if (dot) dot.hidden = !hidden.some((a) => this.#badges.has(a.name));
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
        attrs: { type: "button", role: "menuitem", "data-action": action.name },
        children: [VelvetComponent.icon(action.icon), el("span", { text: action.label }),
          el("span", { cls: `${CLS}-cmd-dot`, attrs: { hidden: "" } })]
      });
      row.addEventListener("click", () => {
        this.#closeOverflow(true);
        action.onTap();
      });
      return row;
    });

    this.#overflow = el("div", {
      cls: `${CLS}-cmd-overflow`,
      attrs: { role: "menu", "aria-label": game.i18n.localize(`${L10N}.Shell.More`) },
      children: rows
    });
    this.element.append(this.#overflow);
    this.#slot("more")?.setAttribute("aria-expanded", "true");

    // Bound on the next frame: the tap that opened the menu is still
    // travelling, and would otherwise close it again immediately.
    this.#overflowAbort = new AbortController();
    const { signal } = this.#overflowAbort;
    this.#syncState();
    rows[0]?.focus();
    this.#overflow.addEventListener("keydown", (event) => {
      const index = rows.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.#closeOverflow(true);
      } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1
          : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        rows[next]?.focus();
      }
    }, { signal });
    document.addEventListener("focusin", (event) => {
      if (!this.element?.contains(event.target)) this.#closeOverflow();
    }, { signal });
    requestAnimationFrame(() => {
      if (signal.aborted) return;
      document.addEventListener("pointerdown", (event) => {
        if (!this.element?.contains(event.target)) this.#closeOverflow();
      }, { signal });
    });
  }

  #closeOverflow(restoreFocus = false) {
    this.#overflowAbort?.abort();
    this.#overflowAbort = null;
    this.#overflow?.remove();
    this.#overflow = null;
    this.#slot("more")?.setAttribute("aria-expanded", "false");
    if (restoreFocus) this.#slot("more")?.focus();
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
