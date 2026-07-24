/**
 * Velvet Mobile — GestureEngine service.
 *
 * Public entry point of the gesture system: `on(element, type, handler)`
 * lazily creates one GestureController per element and returns an
 * unsubscribe function. The whole engine tears down cleanly on disable.
 *
 * @module gestures/engine
 */

import { GestureController } from "./controller.mjs";
import { createRecognizer } from "./recognizers.mjs";

export class GestureEngine {
  /** @type {string} */
  name = "gestures";

  /** @type {Map<HTMLElement, GestureController>} */
  #controllers = new Map();

  /**
   * Recognizers are built on Pointer Events, so they work with mouse input
   * too — essential when testing "Force Phone" from a desktop client.
   * Controllers attach lazily, so an idle engine costs nothing.
   * @returns {boolean}
   */
  shouldEnable() {
    return true;
  }

  enable() {
    /* Controllers attach lazily via on(); nothing global to install. */
  }

  disable() {
    for (const controller of this.#controllers.values()) controller.dispose();
    this.#controllers.clear();
  }

  /**
   * Observe a gesture on an element.
   * @param {HTMLElement} element
   * @param {"tap"|"doubletap"|"longpress"|"swipe"|"edgeswipe"|"pan"|"pinch"} type
   * @param {(event: object) => void} handler
   * @param {object} [options]  Recognizer-specific options (see recognizers.mjs).
   * @returns {() => void} Unsubscribe function.
   */
  on(element, type, handler, options = {}) {
    let controller = this.#controllers.get(element);
    if (!controller) {
      controller = new GestureController(element);
      this.#controllers.set(element, controller);
    }
    const recognizer = createRecognizer(type, handler, options);
    controller.add(recognizer);
    return () => {
      controller.remove(recognizer);
      if (controller.empty) {
        controller.dispose();
        this.#controllers.delete(element);
      }
    };
  }
}
