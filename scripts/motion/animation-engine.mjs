/**
 * Velvet Mobile — Motion system.
 *
 * Every animation in the module flows through this engine so that duration,
 * easing and reduced-motion behavior stay consistent. Built on the Web
 * Animations API (compositor-friendly: transform/opacity only by convention).
 *
 * @module motion/animation-engine
 */

/** Canonical durations (ms). Mirrors --vm-anim-* tokens in tokens.css. */
export const DURATION = Object.freeze({
  FAST: 150,
  NORMAL: 250,
  SLOW: 350
});

/** Canonical easing curves. */
export const EASING = Object.freeze({
  STANDARD: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  DECELERATE: "cubic-bezier(0.05, 0.7, 0.1, 1)",
  ACCELERATE: "cubic-bezier(0.3, 0, 0.8, 0.15)"
});

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

export class Motion {
  /** @returns {boolean} Whether the user requested reduced motion. */
  static get reduced() {
    return reducedMotion.matches;
  }

  /**
   * Animate an element. Resolves when finished; never rejects (cancelled
   * animations resolve silently so callers can chain without guards).
   * @param {HTMLElement} element
   * @param {Keyframe[]|PropertyIndexedKeyframes} keyframes
   * @param {object} [options]
   * @param {number} [options.duration]
   * @param {string} [options.easing]
   * @param {FillMode} [options.fill]
   * @returns {Promise<void>}
   */
  static async animate(element, keyframes, { duration = DURATION.NORMAL, easing = EASING.STANDARD, fill = "both" } = {}) {
    // Callers animate surfaces that a concurrent teardown may already have
    // dropped (a drawer dismissed as the shell disables). Resolving is the
    // honest outcome — the animation's end state no longer has anywhere to go.
    if (!element) return;
    if (Motion.reduced) duration = 0;
    const animation = element.animate(keyframes, { duration, easing, fill });
    try {
      await animation.finished;
      // Persist the final frame as inline style, then drop the animation.
      // A live fill-mode effect would silently override every later
      // style.transform write (drags, snaps), so it must not outlive us.
      animation.commitStyles();
    } catch {
      /* cancelled or non-rendered element — the caller's state still applies */
    } finally {
      animation.cancel();
    }
  }

  /**
   * Slide an element vertically between two transform states.
   * @param {HTMLElement} element
   * @param {string} from  CSS transform, e.g. "translateY(100%)"
   * @param {string} to    CSS transform, e.g. "translateY(0)"
   * @param {object} [options]  Same options as {@link Motion.animate}.
   * @returns {Promise<void>}
   */
  static slide(element, from, to, options = {}) {
    return Motion.animate(element, [{ transform: from }, { transform: to }], {
      easing: EASING.DECELERATE,
      ...options
    });
  }

  /**
   * Fade an element's opacity.
   * @param {HTMLElement} element
   * @param {number} from
   * @param {number} to
   * @param {object} [options]
   * @returns {Promise<void>}
   */
  static fade(element, from, to, options = {}) {
    return Motion.animate(element, [{ opacity: from }, { opacity: to }], {
      duration: DURATION.FAST,
      ...options
    });
  }
}
