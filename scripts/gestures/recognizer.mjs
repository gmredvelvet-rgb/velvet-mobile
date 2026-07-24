/**
 * Velvet Mobile — gesture recognizer base.
 *
 * Each recognizer is a small state machine fed by a GestureController with
 * normalized pointer sessions. Phases follow the classic recognizer model:
 *
 *   possible ──▶ began ──▶ changed* ──▶ ended
 *       │           └───────┬──────────▶ cancelled
 *       └──▶ failed ◀───────┘
 *
 * A recognizer that begins may claim exclusivity through its controller,
 * failing every sibling still in `possible` and cancelling active ones —
 * that is the whole conflict-arbitration model, and it is enough.
 *
 * @module gestures/recognizer
 */

/** Recognizer lifecycle phases. */
export const Phase = Object.freeze({
  POSSIBLE: "possible",
  BEGAN: "began",
  CHANGED: "changed",
  ENDED: "ended",
  CANCELLED: "cancelled",
  FAILED: "failed"
});

/**
 * Compute pointer velocity from a trailing window of movement samples.
 * @param {{t: number, x: number, y: number}[]} samples
 * @param {number} [windowMs]  How far back to look.
 * @returns {{vx: number, vy: number, speed: number}}  Pixels per millisecond.
 */
export function velocityOf(samples, windowMs = 100) {
  if (samples.length < 2) return { vx: 0, vy: 0, speed: 0 };
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (let i = samples.length - 2; i >= 0; i--) {
    first = samples[i];
    if (last.t - samples[i].t > windowMs) break;
  }
  const dt = Math.max(1, last.t - first.t);
  const vx = (last.x - first.x) / dt;
  const vy = (last.y - first.y) / dt;
  return { vx, vy, speed: Math.hypot(vx, vy) };
}

/**
 * @typedef {object} PointerTrack
 * @property {number} id
 * @property {number} startX
 * @property {number} startY
 * @property {number} x
 * @property {number} y
 * @property {number} startTime
 * @property {{t: number, x: number, y: number}[]} samples
 * @property {EventTarget|null} target  Original event target of pointerdown.
 */

/**
 * @typedef {object} GestureSession
 * @property {Map<number, PointerTrack>} pointers  Currently active tracks.
 * @property {PointerTrack} primary                First pointer of the session.
 * @property {number} maxCount                     Peak simultaneous pointers.
 */

export class GestureRecognizer {
  /** @type {string} Public gesture type name ("tap", "pan", …). */
  type;

  /** @type {string} Current phase. */
  phase = Phase.POSSIBLE;

  /** @type {import("./controller.mjs").GestureController|null} Set by the controller on add(). */
  controller = null;

  /** @type {(event: object) => void} */
  #handler;

  /** @type {object} */
  options;

  /**
   * @param {string} type
   * @param {(event: object) => void} handler
   * @param {object} [options]
   */
  constructor(type, handler, options = {}) {
    this.type = type;
    this.#handler = handler;
    this.options = options;
  }

  /* -- Controller callbacks, overridden by subclasses ------------------ */

  /** @param {GestureSession} session @param {PointerEvent} event */
  onPointerDown(session, event) {} // eslint-disable-line no-unused-vars

  /** @param {GestureSession} session @param {PointerEvent} event */
  onPointerMove(session, event) {} // eslint-disable-line no-unused-vars

  /** @param {GestureSession} session @param {PointerEvent} event */
  onPointerUp(session, event) {} // eslint-disable-line no-unused-vars

  /** Session torn down (all pointers up or cancelled). */
  onSessionEnd() {}

  /* -- State machine ---------------------------------------------------- */

  /**
   * Advance the phase, emitting to the handler for observable phases.
   * @param {string} phase
   * @param {object} [detail]
   */
  transition(phase, detail = {}) {
    this.phase = phase;
    if (phase === Phase.FAILED || phase === Phase.POSSIBLE) return;
    this.#handler({ type: this.type, phase, ...detail });
  }

  /** Fail silently if the gesture has not begun. */
  fail() {
    if (this.phase === Phase.POSSIBLE) this.phase = Phase.FAILED;
  }

  /** Cancel (with notification) if the gesture is mid-flight. */
  cancel() {
    if (this.phase === Phase.BEGAN || this.phase === Phase.CHANGED) {
      this.transition(Phase.CANCELLED);
    } else {
      this.fail();
    }
  }

  /** @returns {boolean} */
  get active() {
    return this.phase === Phase.BEGAN || this.phase === Phase.CHANGED;
  }

  /** Return to `possible` for the next session. */
  reset() {
    this.phase = Phase.POSSIBLE;
  }
}
