/**
 * Velvet Mobile — Joystick.
 *
 * A mobile-game style analog stick that steps the token one grid square at
 * a time, in 8 directions — the touch equivalent of arrow-key movement.
 * The knob follows the finger (clamped to the base radius); while it is
 * held past the dead zone the movement callback repeats, faster the harder
 * you push. Movement is grid-stepped by the shell, so this component only
 * emits normalized {-1,0,1} direction deltas.
 *
 * @module components/joystick
 */

import { VelvetComponent } from "./component.mjs";

/** Fraction of the base radius the knob must pass before movement engages. */
const DEADZONE = 0.34;

/** Repeat interval bounds (ms): a full push is fastest. */
const INTERVAL_SLOW = 260;
const INTERVAL_FAST = 110;

/** octant index (from atan2, screen coords) → [dx, dy]. */
const OCTANTS = {
  "0": [1, 0], "1": [1, 1], "2": [0, 1], "3": [-1, 1],
  "4": [-1, 0], "-4": [-1, 0], "-3": [-1, -1], "-2": [0, -1], "-1": [1, -1]
};

export class Joystick extends VelvetComponent {
  /** @type {(dx: number, dy: number) => (void|Promise<void>)} */
  #onStep;

  /** @type {HTMLElement|null} */
  #base = null;

  /** @type {HTMLElement|null} */
  #knob = null;

  /** @type {{x: number, y: number}} Current 8-way direction. */
  #dir = { x: 0, y: 0 };

  /** @type {number} Push magnitude 0..1 (drives repeat speed). */
  #mag = 0;

  /** @type {number|null} Self-rescheduling step timer. */
  #timer = null;

  /**
   * @param {object} options
   * @param {(dx: number, dy: number) => (void|Promise<void>)} options.onStep
   */
  constructor({ onStep }) {
    super();
    this.#onStep = onStep;
  }

  /** @override @returns {HTMLElement} */
  build() {
    const el = VelvetComponent.el;
    this.#knob = el("div", { cls: "vm-joy-knob" });
    this.#base = el("div", {
      cls: "vm-joy-base",
      children: [el("span", { cls: "vm-joy-ring" }), this.#knob]
    });
    const root = el("div", {
      cls: "vm-joystick",
      attrs: { role: "application", "aria-label": "Move token" },
      children: [this.#base]
    });
    this.gesture(this.#base, "pan", (g) => this.#onPan(g), { threshold: 0 });
    return root;
  }

  /** @override */
  destroy() {
    this.#stop();
    super.destroy();
  }

  /* -- Internals ---------------------------------------------------------- */

  /** @param {object} g Pan gesture event. */
  #onPan(g) {
    if (g.phase === "ended" || g.phase === "cancelled") return void this.#release();
    const rect = this.#base.getBoundingClientRect();
    const max = rect.width / 2;
    let vx = g.x - (rect.left + rect.width / 2);
    let vy = g.y - (rect.top + rect.height / 2);
    const dist = Math.hypot(vx, vy);
    if (dist > max && dist > 0) {
      vx = (vx / dist) * max;
      vy = (vy / dist) * max;
    }
    this.#knob.classList.remove("vm-snap");
    this.#knob.style.transform = `translate(-50%, -50%) translate(${vx}px, ${vy}px)`;
    this.#setDirection(vx, vy, max);
  }

  /** @param {number} vx @param {number} vy @param {number} max */
  #setDirection(vx, vy, max) {
    const dist = Math.hypot(vx, vy);
    if (dist < max * DEADZONE) {
      this.#dir = { x: 0, y: 0 };
      this.#base.removeAttribute("data-dir");
      this.#stop();
      return;
    }
    this.#mag = Math.min(1, dist / max);
    const octant = Math.round(Math.atan2(vy, vx) / (Math.PI / 4));
    const [dx, dy] = OCTANTS[String(octant)] ?? [0, 0];
    const changed = dx !== this.#dir.x || dy !== this.#dir.y;
    this.#dir = { x: dx, y: dy };
    this.#base.setAttribute("data-dir", `${dx},${dy}`);
    if (changed) {
      try {
        navigator.vibrate?.(4);
      } catch { /* no haptics */ }
    }
    this.#start();
  }

  #start() {
    if (this.#timer !== null) return;
    this.#timer = setTimeout(() => this.#tick(), 0);
  }

  async #tick() {
    this.#timer = null;
    if (!this.element || (!this.#dir.x && !this.#dir.y)) return;
    try {
      await this.#onStep(this.#dir.x, this.#dir.y);
    } catch { /* the shell logs move failures */ }
    if (!this.element || (!this.#dir.x && !this.#dir.y)) return;
    const interval = Math.round(INTERVAL_SLOW - (INTERVAL_SLOW - INTERVAL_FAST) * this.#mag);
    this.#timer = setTimeout(() => this.#tick(), interval);
  }

  #stop() {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  #release() {
    this.#stop();
    this.#dir = { x: 0, y: 0 };
    this.#base.removeAttribute("data-dir");
    this.#knob.classList.add("vm-snap");
    this.#knob.style.transform = "translate(-50%, -50%)";
  }
}
