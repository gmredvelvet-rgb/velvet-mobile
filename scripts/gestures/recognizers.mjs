/**
 * Velvet Mobile — concrete gesture recognizers.
 *
 * All coordinates are client-space pixels; all velocities are px/ms.
 * Every recognizer emits `{ type, phase, ...detail }` objects through the
 * handler passed at construction (see recognizer.mjs for the phase model).
 *
 * @module gestures/recognizers
 */

import { GestureRecognizer, Phase, velocityOf } from "./recognizer.mjs";

/** Movement tolerance (px) before a stationary gesture fails. */
const SLOP = 10;

/**
 * Tap / multi-tap. `options.taps` (default 1) sets the required count;
 * consecutive taps must land within `interval` ms and `SLOP * 2` px.
 */
export class TapRecognizer extends GestureRecognizer {
  #count = 0;
  #lastTapTime = 0;
  #lastX = 0;
  #lastY = 0;

  constructor(handler, options = {}) {
    super(options.taps > 1 ? "doubletap" : "tap", handler, {
      taps: 1, maxDuration: 300, interval: 300, ...options
    });
  }

  onPointerUp(session, event) {
    if (this.phase !== Phase.POSSIBLE) return;
    const t = session.primary;
    if (session.maxCount > 1) return this.fail();
    const duration = event.timeStamp - t.startTime;
    const moved = Math.hypot(t.x - t.startX, t.y - t.startY);
    if (duration > this.options.maxDuration || moved > SLOP) return this.fail();

    const sinceLast = event.timeStamp - this.#lastTapTime;
    const nearLast = Math.hypot(t.x - this.#lastX, t.y - this.#lastY) <= SLOP * 2;
    this.#count = (this.#count > 0 && sinceLast <= this.options.interval && nearLast) ? this.#count + 1 : 1;
    this.#lastTapTime = event.timeStamp;
    this.#lastX = t.x;
    this.#lastY = t.y;

    if (this.#count >= this.options.taps) {
      this.#count = 0;
      this.transition(Phase.ENDED, { x: t.x, y: t.y, target: t.target });
    } else {
      this.fail();
    }
  }
}

/**
 * Long press. Emits `began` when the hold time elapses (haptic moment),
 * `ended` on release. Fails on movement or a second pointer.
 */
export class LongPressRecognizer extends GestureRecognizer {
  #timer = null;

  constructor(handler, options = {}) {
    super("longpress", handler, { duration: 450, ...options });
  }

  onPointerDown(session) {
    if (session.pointers.size > 1) {
      this.#clear();
      return this.cancel();
    }
    const t = session.primary;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.controller?.claim(this);
      this.transition(Phase.BEGAN, { x: t.x, y: t.y, target: t.target });
    }, this.options.duration);
  }

  onPointerMove(session) {
    if (this.phase !== Phase.POSSIBLE || !this.#timer) return;
    const t = session.primary;
    if (Math.hypot(t.x - t.startX, t.y - t.startY) > SLOP) {
      this.#clear();
      this.fail();
    }
  }

  onPointerUp(session) {
    this.#clear();
    if (this.phase === Phase.BEGAN) {
      const t = session.primary;
      this.transition(Phase.ENDED, { x: t.x, y: t.y, target: t.target });
    } else {
      this.fail();
    }
  }

  onSessionEnd() {
    this.#clear();
  }

  #clear() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
  }
}

/**
 * Swipe: a fast single-pointer flick. Evaluated on release.
 * Emits `ended` with `{ direction, distance, vx, vy, speed }`.
 */
export class SwipeRecognizer extends GestureRecognizer {
  constructor(handler, options = {}) {
    super("swipe", handler, { minDistance: 30, minVelocity: 0.4, maxDuration: 800, ...options });
  }

  onPointerUp(session, event) {
    if (this.phase !== Phase.POSSIBLE) return;
    if (session.maxCount > 1) return this.fail();
    const t = session.primary;
    const dx = t.x - t.startX;
    const dy = t.y - t.startY;
    const distance = Math.hypot(dx, dy);
    const duration = event.timeStamp - t.startTime;
    const v = velocityOf(t.samples);
    if (duration > this.options.maxDuration || distance < this.options.minDistance || v.speed < this.options.minVelocity) {
      return this.fail();
    }
    const direction = Math.abs(dx) >= Math.abs(dy)
      ? (dx > 0 ? "right" : "left")
      : (dy > 0 ? "down" : "up");
    if (!this.matchesStart(t) || (this.options.direction && direction !== this.options.direction)) {
      return this.fail();
    }
    this.transition(Phase.ENDED, { direction, distance, ...v, target: t.target });
  }

  /**
   * Start-position constraint hook (see EdgeSwipeRecognizer).
   * @param {import("./recognizer.mjs").PointerTrack} track
   * @returns {boolean}
   */
  matchesStart(track) { // eslint-disable-line no-unused-vars
    return true;
  }
}

/**
 * Edge swipe: a swipe that starts within `edgeSize` px of a viewport edge
 * and moves inward. `options.edge`: "left" | "right" | "top" | "bottom".
 */
export class EdgeSwipeRecognizer extends SwipeRecognizer {
  constructor(handler, options = {}) {
    const edge = options.edge ?? "left";
    const inward = { left: "right", right: "left", top: "down", bottom: "up" }[edge];
    super(handler, { edgeSize: 28, ...options, edge, direction: inward });
    this.type = "edgeswipe";
  }

  /** @override */
  matchesStart(track) {
    const s = this.options.edgeSize;
    switch (this.options.edge) {
      case "left": return track.startX <= s;
      case "right": return track.startX >= window.innerWidth - s;
      case "top": return track.startY <= s;
      case "bottom": return track.startY >= window.innerHeight - s;
      default: return false;
    }
  }
}

/**
 * Pan: continuous single-pointer drag. `began` after crossing the slop,
 * `changed` per move with `{ dx, dy, x, y, vx, vy }`, `ended` with final
 * deltas and release velocity (momentum input).
 */
export class PanRecognizer extends GestureRecognizer {
  constructor(handler, options = {}) {
    super("pan", handler, { threshold: 8, ...options });
  }

  onPointerDown(session) {
    if (session.pointers.size > 1 && this.active && !this.options.allowMultitouch) this.cancel();
  }

  onPointerMove(session, event) {
    if (event.pointerId !== session.primary.id) return;
    const t = session.primary;
    const dx = t.x - t.startX;
    const dy = t.y - t.startY;
    if (this.phase === Phase.POSSIBLE) {
      if (Math.hypot(dx, dy) < this.options.threshold) return;
      if (session.pointers.size > 1 && !this.options.allowMultitouch) return this.fail();
      this.transition(Phase.BEGAN, { dx, dy, x: t.x, y: t.y, target: t.target });
    }
    if (this.active) {
      const v = velocityOf(t.samples);
      this.transition(Phase.CHANGED, { dx, dy, x: t.x, y: t.y, ...v, target: t.target });
    }
  }

  onPointerUp(session, event) {
    if (event.pointerId !== session.primary.id) return;
    if (!this.active) return this.fail();
    const t = session.primary;
    this.transition(Phase.ENDED, {
      dx: t.x - t.startX,
      dy: t.y - t.startY,
      x: t.x,
      y: t.y,
      ...velocityOf(t.samples),
      target: t.target
    });
  }
}

/**
 * Pinch: two-pointer scale + rotation + center. `changed` emits
 * `{ scale, rotation, centerX, centerY }` (rotation in degrees).
 */
export class PinchRecognizer extends GestureRecognizer {
  #startDistance = 0;
  #startAngle = 0;

  constructor(handler, options = {}) {
    super("pinch", handler, options);
  }

  onPointerDown(session) {
    if (session.pointers.size !== 2 || this.phase !== Phase.POSSIBLE) return;
    const [a, b] = [...session.pointers.values()];
    this.#startDistance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    this.#startAngle = Math.atan2(b.y - a.y, b.x - a.x);
    this.controller?.claim(this);
    this.transition(Phase.BEGAN, this.#measure(a, b));
  }

  onPointerMove(session) {
    if (!this.active || session.pointers.size < 2) return;
    const [a, b] = [...session.pointers.values()];
    this.transition(Phase.CHANGED, this.#measure(a, b));
  }

  onPointerUp(session) {
    if (!this.active) return this.fail();
    if (session.pointers.size <= 2) {
      const [a, b] = [...session.pointers.values()];
      this.transition(Phase.ENDED, b ? this.#measure(a, b) : {});
    }
  }

  /**
   * @param {import("./recognizer.mjs").PointerTrack} a
   * @param {import("./recognizer.mjs").PointerTrack} b
   */
  #measure(a, b) {
    const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    return {
      scale: distance / this.#startDistance,
      rotation: ((angle - this.#startAngle) * 180) / Math.PI,
      centerX: (a.x + b.x) / 2,
      centerY: (a.y + b.y) / 2
    };
  }
}

/** Factory: gesture type name → recognizer instance. */
export function createRecognizer(type, handler, options = {}) {
  switch (type) {
    case "tap": return new TapRecognizer(handler, options);
    case "doubletap": return new TapRecognizer(handler, { ...options, taps: 2 });
    case "longpress": return new LongPressRecognizer(handler, options);
    case "swipe": return new SwipeRecognizer(handler, options);
    case "edgeswipe": return new EdgeSwipeRecognizer(handler, options);
    case "pan": return new PanRecognizer(handler, options);
    case "pinch": return new PinchRecognizer(handler, options);
    default: throw new Error(`Unknown gesture type "${type}"`);
  }
}
