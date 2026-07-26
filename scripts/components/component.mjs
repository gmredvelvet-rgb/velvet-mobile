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

  /** @type {Set<{dispose: () => void}>} Live sub-scopes, disposed with the component. */
  #scopes = new Set();

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

  /**
   * A disposable child scope with the same `listen`/`gesture` contract.
   *
   * `listen()` and `gesture()` above live as long as the component does,
   * which is correct for chrome built once but wrong for anything rebuilt on
   * every render: the AbortSignal keeps each detached node's listener alive,
   * and the GestureEngine keys its controller map by element, so re-rendered
   * subtrees accumulate for the component's whole lifetime. Give those a
   * scope and dispose it before each rebuild.
   *
   * @returns {{listen: Function, gesture: Function, dispose: () => void}}
   */
  scope() {
    const abort = new AbortController();
    const offs = [];
    const scope = {
      listen: (target, event, handler, options = {}) => {
        target.addEventListener(event, handler, { ...options, signal: abort.signal });
      },
      gesture: (element, type, handler, options = {}) => {
        if (!services.gestures) return;
        offs.push(services.gestures.on(element, type, handler, options));
      },
      dispose: () => {
        abort.abort();
        for (const off of offs) off();
        offs.length = 0;
        this.#scopes.delete(scope);
      }
    };
    this.#scopes.add(scope);
    return scope;
  }

  /** Remove the component and every listener/gesture it registered. */
  destroy() {
    // Deleting the current entry mid-iteration is safe on a Set.
    for (const scope of this.#scopes) scope.dispose();
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
