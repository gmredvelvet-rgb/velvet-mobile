/**
 * Velvet Mobile — device profiler.
 *
 * Produces an immutable device profile from multiple browser signals and
 * re-emits it whenever any signal changes. This is the single source of
 * truth the whole module reacts to; no other file may query media queries
 * or user-agent data directly.
 *
 * Signals combined (no single signal is trusted alone):
 *  - `(pointer)` / `(hover)` / `(any-pointer)` media features
 *  - `navigator.maxTouchPoints`
 *  - viewport dimensions and `window.visualViewport` (keyboard-aware)
 *  - `(orientation)` media feature
 *  - viewport-segments media features (foldables)
 *  - `devicePixelRatio`
 *
 * @module responsive/device-profiler
 */

import {
  DEVICES, INPUTS, MODES, ORIENTATIONS,
  PHONE_MAX_MIN_DIMENSION, REFRESH_DEBOUNCE_MS, SIZE_BUCKETS
} from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";

/**
 * @typedef {object} DeviceProfile
 * @property {string} device        One of {@link DEVICES}.
 * @property {string} input         One of {@link INPUTS}.
 * @property {string} orientation   One of {@link ORIENTATIONS}.
 * @property {string} size          Width bucket id (xs…xl).
 * @property {boolean} foldable     Multi-segment viewport detected.
 * @property {boolean} forced       Device classification forced by the mode setting.
 * @property {number}  dpr          Device pixel ratio.
 * @property {{width: number, height: number, visualHeight: number}} viewport
 */

/** Media queries the profiler subscribes to. Keys are internal names. */
const QUERIES = {
  coarse: "(pointer: coarse)",
  noHover: "(hover: none)",
  anyFine: "(any-pointer: fine)",
  portrait: "(orientation: portrait)",
  foldH: "(horizontal-viewport-segments: 2)",
  foldV: "(vertical-viewport-segments: 2)"
};

export class DeviceProfiler {
  /** @type {Readonly<DeviceProfile>|null} */
  #profile = null;

  /** @type {Map<string, MediaQueryList>} */
  #media = new Map();

  /** @type {AbortController|null} Detaches every listener in one call. */
  #abort = null;

  /** @type {number|null} */
  #debounceId = null;

  /** @type {() => string} Supplies the current `mode` setting. */
  #getMode;

  /** @type {(profile: Readonly<DeviceProfile>, old: Readonly<DeviceProfile>|null) => void} */
  #onChange;

  /**
   * @param {object} options
   * @param {() => string} options.getMode      Reads the current mode setting.
   * @param {(profile: Readonly<DeviceProfile>, old: Readonly<DeviceProfile>|null) => void} options.onChange
   *        Invoked with the new profile whenever it differs from the previous one.
   */
  constructor({ getMode, onChange }) {
    this.#getMode = getMode;
    this.#onChange = onChange;
  }

  /** @returns {Readonly<DeviceProfile>|null} The current profile. */
  get profile() {
    return this.#profile;
  }

  /** Begin observing signals and emit the initial profile synchronously. */
  start() {
    if (this.#abort) return;
    this.#abort = new AbortController();
    const { signal } = this.#abort;
    const refresh = () => this.#scheduleRefresh();

    for (const [key, query] of Object.entries(QUERIES)) {
      const mql = window.matchMedia(query);
      this.#media.set(key, mql);
      mql.addEventListener("change", refresh, { signal });
    }
    window.addEventListener("resize", refresh, { signal });
    window.visualViewport?.addEventListener("resize", refresh, { signal });
    window.visualViewport?.addEventListener("scroll", refresh, { signal });

    this.#refresh();
  }

  /** Stop observing. Safe to call repeatedly. */
  stop() {
    this.#abort?.abort();
    this.#abort = null;
    this.#media.clear();
    if (this.#debounceId !== null) {
      clearTimeout(this.#debounceId);
      this.#debounceId = null;
    }
    this.#profile = null;
  }

  /** Recompute immediately, bypassing the debounce (used on setting changes). */
  refresh() {
    if (!this.#abort) return;
    if (this.#debounceId !== null) {
      clearTimeout(this.#debounceId);
      this.#debounceId = null;
    }
    this.#refresh();
  }

  #scheduleRefresh() {
    if (this.#debounceId !== null) clearTimeout(this.#debounceId);
    this.#debounceId = setTimeout(() => {
      this.#debounceId = null;
      this.#refresh();
    }, REFRESH_DEBOUNCE_MS);
  }

  #refresh() {
    const next = this.#compute();
    const prev = this.#profile;
    if (prev && DeviceProfiler.#equals(prev, next)) return;
    this.#profile = next;
    Logger.debug("Device profile", next);
    this.#onChange(next, prev);
  }

  /**
   * @returns {Readonly<DeviceProfile>}
   */
  #compute() {
    const matches = (key) => this.#media.get(key)?.matches ?? false;
    const width = window.innerWidth;
    const height = window.innerHeight;
    const visualHeight = Math.round(window.visualViewport?.height ?? height);
    const minDimension = Math.min(width, height);

    const input = DeviceProfiler.#classifyInput(matches);
    const { device, forced } = DeviceProfiler.#classifyDevice(this.#getMode(), matches("coarse"), minDimension);

    return Object.freeze({
      device,
      input,
      forced,
      orientation: matches("portrait") ? ORIENTATIONS.PORTRAIT : ORIENTATIONS.LANDSCAPE,
      size: SIZE_BUCKETS.find((b) => width < b.max).id,
      foldable: matches("foldH") || matches("foldV"),
      dpr: window.devicePixelRatio ?? 1,
      viewport: Object.freeze({ width, height, visualHeight })
    });
  }

  /**
   * Input classification: the primary pointer decides touch vs mouse; the
   * presence of a secondary fine pointer on a touch-primary device (or touch
   * points on a mouse-primary one) marks it hybrid.
   * @param {(key: string) => boolean} matches
   * @returns {string}
   */
  static #classifyInput(matches) {
    const hasTouch = (navigator.maxTouchPoints ?? 0) > 0;
    if (matches("coarse")) return matches("anyFine") ? INPUTS.HYBRID : INPUTS.TOUCH;
    return hasTouch ? INPUTS.HYBRID : INPUTS.MOUSE;
  }

  /**
   * Device classification. The mode setting can force phone/tablet; in auto
   * mode a coarse primary pointer marks a real mobile device, split by its
   * smaller viewport dimension so orientation changes never reclassify it.
   *
   * The gate is the PRIMARY pointer, not "touch and nothing else": phones
   * with a stylus (or any secondary fine pointer) also match `any-pointer:
   * fine`, and requiring pure touch misclassified them as desktops.
   * Touch-capable laptops keep a fine primary pointer, so they correctly
   * stay desktop.
   * @param {string} mode
   * @param {boolean} coarsePrimary   Whether `(pointer: coarse)` matches.
   * @param {number} minDimension
   * @returns {{device: string, forced: boolean}}
   */
  static #classifyDevice(mode, coarsePrimary, minDimension) {
    if (mode === MODES.PHONE) return { device: DEVICES.PHONE, forced: true };
    if (mode === MODES.TABLET) return { device: DEVICES.TABLET, forced: true };
    if (!coarsePrimary) return { device: DEVICES.DESKTOP, forced: false };
    return {
      device: minDimension < PHONE_MAX_MIN_DIMENSION ? DEVICES.PHONE : DEVICES.TABLET,
      forced: false
    };
  }

  /**
   * Structural equality for profiles (viewport compared field-by-field).
   * @param {DeviceProfile} a
   * @param {DeviceProfile} b
   * @returns {boolean}
   */
  static #equals(a, b) {
    return a.device === b.device
      && a.input === b.input
      && a.orientation === b.orientation
      && a.size === b.size
      && a.foldable === b.foldable
      && a.forced === b.forced
      && a.dpr === b.dpr
      && a.viewport.width === b.viewport.width
      && a.viewport.height === b.viewport.height
      && a.viewport.visualHeight === b.viewport.visualHeight;
  }
}
