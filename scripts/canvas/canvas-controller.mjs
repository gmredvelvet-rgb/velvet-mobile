/**
 * Velvet Mobile — CanvasController.
 *
 * Makes the game canvas usable with fingers: one-finger drag pans the
 * board, two fingers pinch to zoom around their midpoint. Foundry's canvas
 * has no touch navigation of its own, so without this the map would be
 * visible but frozen on a phone.
 *
 * Only active when the map is enabled (otherwise there is no canvas at
 * all — see main.mjs's core.noCanvas handling).
 *
 * @module canvas/canvas-controller
 */

import { DEVICES } from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";
import { Settings } from "../core/settings.mjs";
import { services } from "../core/services.mjs";

/** Zoom limits, matching Foundry's own canvas constraints closely enough. */
const MIN_SCALE = 0.1;
const MAX_SCALE = 3;

export class CanvasController {
  /** @type {string} */
  name = "canvasTouch";

  /** @type {(() => void)[]} Gesture unsubscribers. */
  #off = [];

  /** @type {number|null} Hook handle for canvasReady. */
  #hookId = null;

  /** @type {{x: number, y: number}|null} Pivot at pan start. */
  #panStart = null;

  /** @type {number} Scale at pinch start. */
  #pinchStart = 1;

  /** @param {object} profile @returns {boolean} */
  shouldEnable(profile) {
    return profile.device !== DEVICES.DESKTOP && Settings.map;
  }

  enable() {
    this.#attach();
    // The board element is replaced whenever a scene loads.
    this.#hookId = Hooks.on("canvasReady", () => this.#attach());
  }

  disable() {
    if (this.#hookId !== null) Hooks.off("canvasReady", this.#hookId);
    this.#hookId = null;
    this.#detach();
  }

  /* -- Internals ---------------------------------------------------------- */

  #attach() {
    this.#detach();
    const board = document.getElementById("board");
    if (!board || !services.gestures) return;
    this.#off.push(services.gestures.on(board, "pan", (g) => this.#onPan(g), { threshold: 6 }));
    this.#off.push(services.gestures.on(board, "pinch", (g) => this.#onPinch(g)));
    Logger.debug("Canvas touch navigation attached");
  }

  #detach() {
    for (const off of this.#off) off();
    this.#off.length = 0;
  }

  /** @param {object} g Pan gesture. */
  #onPan(g) {
    if (!canvas?.ready || !canvas.stage) return;
    if (g.phase === "began") {
      this.#panStart = { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y };
      return;
    }
    if (g.phase !== "changed" || !this.#panStart) return;
    // Screen pixels → world units: the further you are zoomed out, the
    // more world the same finger travel covers.
    const scale = canvas.stage.scale.x || 1;
    canvas.pan({
      x: this.#panStart.x - g.dx / scale,
      y: this.#panStart.y - g.dy / scale
    });
  }

  /** @param {object} g Pinch gesture. */
  #onPinch(g) {
    if (!canvas?.ready || !canvas.stage) return;
    if (g.phase === "began") {
      this.#pinchStart = canvas.stage.scale.x || 1;
      return;
    }
    if (g.phase !== "changed") return;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.#pinchStart * (g.scale ?? 1)));
    canvas.pan({ scale });
  }
}
