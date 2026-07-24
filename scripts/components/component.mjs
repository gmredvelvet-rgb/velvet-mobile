/**
 * Velvet Mobile — component base class.
 *
 * Minimal, dependency-free foundation for the Velvet component library.
 * Guarantees the module-wide lifecycle rules: every listener registered
 * through `listen()` and every gesture registered through `gesture()` dies
 * automatically on `destroy()`.
 *
 * @module components/component
 */

import { CLS } from "../core/constants.mjs";
import { services } from "../core/services.mjs";

export class VelvetComponent {
  /** @type {HTMLElement|null} Root element, created by build(). */
  element = null;

  /** @type {AbortController} */
  #abort = new AbortController();

  /** @type {(() => void)[]} Gesture unsubscribers. */
  #gestures = [];

  /**
   * Create the root element. Subclasses must override.
   * @returns {HTMLElement}
   */
  build() {
    throw new Error(`${this.constructor.name} must implement build()`);
  }

  /**
   * Build (once) and attach to a parent.
   * @param {HTMLElement} [parent]
   * @returns {this}
   */
  mount(parent = document.body) {
    this.element ??= this.build();
    parent.append(this.element);
    return this;
  }

  /**
   * Auto-cleaned event listener.
   * @param {EventTarget} target
   * @param {string} event
   * @param {(e: Event) => void} handler
   * @param {AddEventListenerOptions} [options]
   */
  listen(target, event, handler, options = {}) {
    target.addEventListener(event, handler, { ...options, signal: this.#abort.signal });
  }

  /**
   * Auto-cleaned gesture subscription (through the GestureEngine).
   * @param {HTMLElement} element
   * @param {string} type
   * @param {(event: object) => void} handler
   * @param {object} [options]
   */
  gesture(element, type, handler, options = {}) {
    if (!services.gestures) return;
    this.#gestures.push(services.gestures.on(element, type, handler, options));
  }

  /** Remove the component and every listener/gesture it registered. */
  destroy() {
    this.#abort.abort();
    for (const off of this.#gestures) off();
    this.#gestures.length = 0;
    this.element?.remove();
    this.element = null;
  }

  /**
   * Element factory.
   * @param {string} tag
   * @param {object} [spec]
   * @param {string} [spec.cls]                    Space-separated class names (auto-prefixed entries use "vm-").
   * @param {Record<string, string>} [spec.attrs]
   * @param {string} [spec.text]
   * @param {(HTMLElement|string)[]} [spec.children]
   * @returns {HTMLElement}
   */
  static el(tag, { cls = "", attrs = {}, text = "", children = [] } = {}) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text) node.textContent = text;
    node.append(...children);
    return node;
  }

  /**
   * Build a Font Awesome icon element (Foundry bundles FA).
   * @param {string} faClasses  e.g. "fa-solid fa-dice-d20"
   * @returns {HTMLElement}
   */
  static icon(faClasses) {
    return VelvetComponent.el("i", { cls: `${faClasses} ${CLS}-icon`, attrs: { "aria-hidden": "true" } });
  }
}
