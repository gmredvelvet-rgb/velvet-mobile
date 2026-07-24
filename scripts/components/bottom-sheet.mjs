/**
 * Velvet Mobile — BottomSheet.
 *
 * The canonical phone container: content slides up from the bottom edge,
 * snaps to configurable heights, follows the finger while dragging and
 * uses release velocity to choose the next snap (or dismiss). All motion
 * is transform-only and flows through the Motion engine.
 *
 * Geometry model: the sheet's height equals the LARGEST snap fraction of
 * the keyboard-aware viewport (--vm-vvh); smaller snaps are reached by
 * translating the sheet down, so snapping never re-layouts content.
 *
 * @module components/bottom-sheet
 */

import { Motion, DURATION } from "../motion/animation-engine.mjs";
import { VelvetComponent } from "./component.mjs";

/** Release velocity (px/ms) that forces a snap change / dismissal. */
const FLING_VELOCITY = 0.5;

export class BottomSheet extends VelvetComponent {
  /** @type {number[]} Ascending snap fractions of the visual viewport (0–1]. */
  #snapPoints;

  /** @type {number} Index into #snapPoints. */
  #snapIndex;

  /** @type {boolean} */
  #dismissible;

  /** @type {boolean} */
  #hasBackdrop;

  /** @type {(() => void)|null} */
  #onDismiss;

  /** @type {HTMLElement|null} */
  #backdrop = null;

  /** @type {HTMLElement|null} */
  #body = null;

  /** @type {number} Live translateY offset (px) while dragging. */
  #dragBase = 0;

  /** @type {boolean} Guards double dismissal. */
  #dismissed = false;

  /**
   * @param {object} options
   * @param {string} [options.title]
   * @param {number[]} [options.snapPoints]     Ascending fractions, e.g. [0.5, 1].
   * @param {number} [options.initialSnap]      Index into snapPoints.
   * @param {boolean} [options.dismissible]     Swipe-down / backdrop-tap closes.
   * @param {boolean} [options.backdrop]
   * @param {string} [options.className]        Extra class on the sheet root.
   * @param {() => void} [options.onDismiss]    Called exactly once after dismissal.
   */
  constructor({
    title = "",
    snapPoints = [0.55, 1],
    initialSnap = 0,
    dismissible = true,
    backdrop = true,
    className = "",
    onDismiss = null
  } = {}) {
    super();
    this.title = title;
    this.className = className;
    this.#snapPoints = [...snapPoints].sort((a, b) => a - b);
    this.#snapIndex = Math.min(initialSnap, this.#snapPoints.length - 1);
    this.#dismissible = dismissible;
    this.#hasBackdrop = backdrop;
    this.#onDismiss = onDismiss;
  }

  /** @returns {HTMLElement} Container callers put content into. */
  get body() {
    return this.#body;
  }

  /** @returns {number} Current snap fraction. */
  get snap() {
    return this.#snapPoints[this.#snapIndex];
  }

  /** @override */
  build() {
    const el = VelvetComponent.el;
    this.#body = el("div", { cls: "vm-sheet-body" });
    const handle = el("div", { cls: "vm-sheet-handle", children: [el("span", { cls: "vm-sheet-grip" })] });
    const header = el("header", {
      cls: "vm-sheet-header",
      children: [
        el("h2", { cls: "vm-sheet-title", text: this.title }),
        el("button", {
          cls: "vm-sheet-close",
          attrs: { type: "button", "aria-label": game.i18n?.localize("Close") ?? "Close" },
          children: [VelvetComponent.icon("fa-solid fa-xmark")]
        })
      ]
    });
    const sheet = el("section", {
      cls: `vm-sheet ${this.className}`.trim(),
      attrs: { role: "dialog", "aria-modal": "true" },
      children: [handle, header, this.#body]
    });
    const root = el("div", { cls: "vm-sheet-root" });
    if (this.#hasBackdrop) {
      this.#backdrop = el("div", { cls: "vm-sheet-backdrop" });
      root.append(this.#backdrop);
    }
    root.append(sheet);
    this.sheet = sheet;

    this.listen(header.querySelector(".vm-sheet-close"), "click", () => this.dismiss());
    if (this.#hasBackdrop && this.#dismissible) {
      this.listen(this.#backdrop, "click", () => this.dismiss());
    }
    for (const grabArea of [handle, header]) {
      this.gesture(grabArea, "pan", (g) => this.#onPan(g));
    }
    return root;
  }

  /** Mount and animate in. @returns {Promise<this>} */
  async open() {
    this.mount();
    this.#applyHeight();
    if (this.#backdrop) Motion.fade(this.#backdrop, 0, 1);
    this.sheet.style.transform = "translateY(100%)";
    await Motion.slide(this.sheet, "translateY(100%)", `translateY(${this.#offsetFor(this.#snapIndex)}px)`);
    this.sheet.style.transform = `translateY(${this.#offsetFor(this.#snapIndex)}px)`;
    return this;
  }

  /**
   * Animate to a snap index.
   * @param {number} index
   */
  async snapTo(index) {
    this.#snapIndex = Math.max(0, Math.min(index, this.#snapPoints.length - 1));
    const y = this.#offsetFor(this.#snapIndex);
    await Motion.slide(this.sheet, this.sheet.style.transform || "translateY(0)", `translateY(${y}px)`, { duration: DURATION.FAST });
    this.sheet.style.transform = `translateY(${y}px)`;
  }

  /** Animate out, invoke onDismiss once, destroy. */
  async dismiss() {
    if (this.#dismissed) return;
    this.#dismissed = true;
    if (this.#backdrop) Motion.fade(this.#backdrop, 1, 0);
    await Motion.slide(this.sheet, this.sheet.style.transform || "translateY(0)", "translateY(100%)", { duration: DURATION.FAST });
    const callback = this.#onDismiss;
    this.#onDismiss = null;
    this.destroy();
    callback?.();
  }

  /* -- Internals --------------------------------------------------------- */

  /** Sheet height = max snap × keyboard-aware viewport height. */
  #applyHeight() {
    const max = this.#snapPoints[this.#snapPoints.length - 1];
    this.sheet.style.height = `calc(var(--vm-vvh, 100dvh) * ${max})`;
  }

  /**
   * translateY offset (px) that presents snapPoints[index].
   * @param {number} index
   * @returns {number}
   */
  #offsetFor(index) {
    const max = this.#snapPoints[this.#snapPoints.length - 1];
    const target = this.#snapPoints[index];
    return this.sheet.getBoundingClientRect().height * (1 - target / max);
  }

  /** @param {object} g Pan gesture event. */
  #onPan(g) {
    if (g.phase === "began") {
      this.#dragBase = this.#offsetFor(this.#snapIndex);
      return;
    }
    if (g.phase === "changed") {
      const y = Math.max(0, this.#dragBase + g.dy);
      this.sheet.style.transform = `translateY(${y}px)`;
      return;
    }
    if (g.phase !== "ended" && g.phase !== "cancelled") return;

    const y = Math.max(0, this.#dragBase + (g.dy ?? 0));
    const height = this.sheet.getBoundingClientRect().height;

    // Fling down past the lowest snap → dismiss.
    if (this.#dismissible && (g.vy ?? 0) > FLING_VELOCITY && this.#snapIndex === 0) return void this.dismiss();
    // Fling chooses direction; otherwise settle on the nearest snap.
    if ((g.vy ?? 0) > FLING_VELOCITY) return void this.snapTo(this.#snapIndex - 1);
    if ((g.vy ?? 0) < -FLING_VELOCITY) return void this.snapTo(this.#snapIndex + 1);

    let nearest = 0;
    let best = Infinity;
    this.#snapPoints.forEach((_, i) => {
      const d = Math.abs(this.#offsetFor(i) - y);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    // Dragged well below the lowest snap → dismiss.
    if (this.#dismissible && y > this.#offsetFor(0) + height * 0.25) return void this.dismiss();
    this.snapTo(nearest);
  }
}
