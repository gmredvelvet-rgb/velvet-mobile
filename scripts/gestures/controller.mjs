/**
 * Velvet Mobile — gesture controller.
 *
 * One controller per observed element. Owns the Pointer Event listeners
 * (down on the element; move/up/cancel on the window only while a session
 * is live), maintains normalized pointer tracks with movement samples, and
 * feeds every registered recognizer. Implements exclusivity arbitration.
 *
 * @module gestures/controller
 */

import { GestureRecognizer, Phase } from "./recognizer.mjs";

/** Maximum movement samples kept per pointer (velocity window). */
const MAX_SAMPLES = 24;

export class GestureController {
  /** @type {HTMLElement} */
  #element;

  /** @type {GestureRecognizer[]} */
  #recognizers = [];

  /** @type {AbortController|null} Element-level listener. */
  #abort = null;

  /** @type {AbortController|null} Window-level listeners, live during a session. */
  #sessionAbort = null;

  /** @type {import("./recognizer.mjs").GestureSession|null} */
  #session = null;

  /** @param {HTMLElement} element */
  constructor(element) {
    this.#element = element;
    this.#abort = new AbortController();
    element.addEventListener("pointerdown", (e) => this.#onDown(e), { signal: this.#abort.signal });
  }

  /** @returns {boolean} */
  get empty() {
    return this.#recognizers.length === 0;
  }

  /**
   * @param {GestureRecognizer} recognizer
   */
  add(recognizer) {
    recognizer.controller = this;
    this.#recognizers.push(recognizer);
  }

  /**
   * @param {GestureRecognizer} recognizer
   */
  remove(recognizer) {
    const i = this.#recognizers.indexOf(recognizer);
    if (i >= 0) this.#recognizers.splice(i, 1);
    recognizer.controller = null;
  }

  /**
   * Exclusivity arbitration: the claimant fails every sibling still in
   * `possible` and cancels any sibling mid-gesture.
   * @param {GestureRecognizer} claimant
   */
  claim(claimant) {
    for (const rec of this.#recognizers) {
      if (rec === claimant) continue;
      rec.active ? rec.cancel() : rec.fail();
    }
  }

  /** Remove every listener and reset state. */
  dispose() {
    this.#endSession(true);
    this.#abort?.abort();
    this.#abort = null;
    this.#recognizers.length = 0;
  }

  /* -- Pointer plumbing -------------------------------------------------- */

  /** @param {PointerEvent} e */
  #onDown(e) {
    if (!this.#session) {
      this.#session = { pointers: new Map(), primary: null, maxCount: 0 };
      this.#sessionAbort = new AbortController();
      const { signal } = this.#sessionAbort;
      window.addEventListener("pointermove", (ev) => this.#onMove(ev), { signal, passive: true });
      window.addEventListener("pointerup", (ev) => this.#onUp(ev), { signal });
      window.addEventListener("pointercancel", (ev) => this.#onCancel(ev), { signal });
      for (const rec of this.#recognizers) rec.reset();
    }
    const track = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      startTime: e.timeStamp,
      samples: [{ t: e.timeStamp, x: e.clientX, y: e.clientY }],
      target: e.target
    };
    this.#session.pointers.set(e.pointerId, track);
    this.#session.primary ??= track;
    this.#session.maxCount = Math.max(this.#session.maxCount, this.#session.pointers.size);
    for (const rec of this.#recognizers) rec.onPointerDown(this.#session, e);
  }

  /** @param {PointerEvent} e */
  #onMove(e) {
    const track = this.#session?.pointers.get(e.pointerId);
    if (!track) return;
    track.x = e.clientX;
    track.y = e.clientY;
    track.samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY });
    if (track.samples.length > MAX_SAMPLES) track.samples.shift();
    for (const rec of this.#recognizers) rec.onPointerMove(this.#session, e);
  }

  /** @param {PointerEvent} e */
  #onUp(e) {
    if (!this.#session?.pointers.has(e.pointerId)) return;
    for (const rec of this.#recognizers) rec.onPointerUp(this.#session, e);
    this.#session.pointers.delete(e.pointerId);
    if (this.#session.pointers.size === 0) this.#endSession(false);
  }

  /** @param {PointerEvent} e */
  #onCancel(e) {
    if (!this.#session?.pointers.has(e.pointerId)) return;
    this.#session.pointers.delete(e.pointerId);
    if (this.#session.pointers.size === 0) this.#endSession(true);
  }

  /**
   * @param {boolean} cancelled
   */
  #endSession(cancelled) {
    if (!this.#session) return;
    for (const rec of this.#recognizers) {
      if (cancelled) rec.cancel();
      rec.onSessionEnd();
      if (rec.phase !== Phase.POSSIBLE) rec.reset();
    }
    this.#sessionAbort?.abort();
    this.#sessionAbort = null;
    this.#session = null;
  }
}
