/**
 * Velvet Mobile — NavStack.
 *
 * The module's single presentation mechanic. Every screen that covers the
 * home view — the character sheet, chat, the encounter list, the target
 * picker, the roster — is a view pushed onto this stack. They enter from the
 * right edge, the view underneath parallaxes back, and the way out is always
 * the same two things: the back chevron, or a drag from the left edge.
 *
 * One mechanic rather than three (drawer, rail, bottom sheet) means a player
 * never has to learn which gesture dismisses the thing currently on screen.
 *
 * Geometry: every view is `position: fixed; inset: 0` and moves on transform
 * only, so pushing a view never re-layouts the one below it.
 *
 * @module components/nav-stack
 */

import { CLS, L10N, ROOT_ATTRS } from "../core/constants.mjs";
import { Motion, DURATION, EASING } from "../motion/animation-engine.mjs";
import { services } from "../core/services.mjs";
import { Logger } from "../core/logger.mjs";
import { VelvetComponent } from "./component.mjs";

/** Distance from the left edge (px) where a back-drag may start. */
const BACK_EDGE = 30;

/** Fraction of the width, or release velocity (px/ms), that completes a back-drag. */
const BACK_FRACTION = 0.35;
const BACK_VELOCITY = 0.45;

/** How far the covered view slides back, as a fraction of its width. */
const PARALLAX = 0.22;

export class NavStack extends VelvetComponent {
  /** @type {NavView[]} Bottom to top. */
  #views = [];

  /**
   * Tail of the pop queue. Overlapping pops are serialised rather than
   * dropped: `popAll`, `popTo` and `reveal` loop until the stack reaches a
   * shape, so a pop that quietly did nothing left them spinning on a
   * condition that could never change — and an `await` loop that never
   * yields to the event loop freezes the tab, not just the animation.
   * @type {Promise<void>}
   */
  #queue = Promise.resolve();

  /** @type {boolean} True while an exit animation is on screen. */
  #animating = false;

  /** @returns {number} */
  get depth() {
    return this.#views.length;
  }

  /** @returns {NavView|null} */
  get top() {
    return this.#views.at(-1) ?? null;
  }

  /** @override */
  build() {
    return VelvetComponent.el("div", { cls: `${CLS}-nav` });
  }

  /**
   * Push a view and animate it in.
   *
   * @param {object} options
   * @param {string} [options.title]         Shown in the nav bar.
   * @param {string} [options.className]     Extra class on the view root.
   * @param {boolean} [options.chrome]       Draw the default nav bar. Views
   *   with their own header (the character sheet) pass false and are still
   *   popped by the back drag.
   * @param {HTMLElement[]} [options.actions] Buttons for the nav bar's right side.
   * @param {string} [options.id]            Identity, so a view can be found or replaced.
   * @param {() => void} [options.onPop]     Called exactly once, after removal.
   * @returns {NavView}
   */
  push({ title = "", className = "", chrome = true, actions = [], id = "", onPop = null } = {}) {
    this.mount();
    const view = new NavView({ stack: this, title, className, chrome, actions, id, onPop });
    const below = this.top;
    this.#views.push(view);
    this.element.append(view.element);

    document.documentElement.setAttribute(ROOT_ATTRS.DRAWER, "");
    // The covered view stops being reachable by touch or by a screen reader
    // the moment it is covered, not when the animation finishes.
    below?.setCovered(true);

    // Motion itself never rejects, but this callback runs a frame later on a
    // view that may already have been popped — so it is guarded rather than
    // left to surface as an unhandled rejection nobody sees.
    Motion.slide(view.element, "translateX(100%)", "translateX(0)")
      .then(() => {
        if (view.element?.isConnected) view.element.style.transform = "";
      })
      .catch((err) => Logger.debug("Screen entrance settled early", err));
    if (below) {
      Motion.slide(below.element, "translateX(0)", `translateX(-${PARALLAX * 100}%)`);
    }
    return view;
  }

  /**
   * Pop the top view.
   * @param {object} [options]
   * @param {boolean} [options.animate]
   * @returns {Promise<void>}
   */
  pop(options = {}) {
    // Leaving the stack and animating away are two different moments.
    //
    // The view is claimed *now*, synchronously: callers guard on `find()` and
    // `includes()` before asking for a pop, and if those still reported a
    // screen that is already on its way out, a second request would close the
    // screen behind it instead. The animation is what gets queued.
    const view = this.#views.pop();
    if (!view) return this.#queue;
    const below = this.top;
    below?.setCovered(false);

    // Never rejecting: the loops below await this, and one failed exit must
    // not take the rest of the stack down with it.
    const run = () => this.#retire(view, below, options)
      .catch((err) => Logger.error("Could not close a screen", err));
    this.#queue = this.#queue.then(run, run);
    return this.#queue;
  }

  /**
   * Animate a claimed view away and dispose of it. Only ever called through
   * the queue in `pop()`, so two exits never overlap on screen.
   * @param {NavView} view
   * @param {NavView|null} below
   * @param {object} [options]
   * @param {boolean} [options.animate]
   */
  async #retire(view, below, { animate = true } = {}) {
    this.#animating = true;
    try {
      if (animate) {
        const from = view.element.style.transform || "translateX(0)";
        await Promise.all([
          Motion.slide(view.element, from, "translateX(100%)", { duration: DURATION.FAST, easing: EASING.ACCELERATE }),
          below ? Motion.slide(below.element, `translateX(-${PARALLAX * 100}%)`, "translateX(0)", { duration: DURATION.FAST }) : null
        ].filter(Boolean));
      }
      if (below?.element) below.element.style.transform = "";
    } finally {
      // Left set by a throw, this would refuse every later back-drag.
      this.#animating = false;
    }

    view.detach();
    if (!this.#views.length) document.documentElement.removeAttribute(ROOT_ATTRS.DRAWER);
  }

  /**
   * Pop every view. Used when the shell tears down or when an action needs a
   * clear screen (rolling from the sheet, walking the token).
   * @param {object} [options]
   * @param {boolean} [options.animate]
   */
  async popAll({ animate = false } = {}) {
    for (let guard = this.#views.length; guard > 0 && this.#views.length; guard -= 1) {
      await this.pop({ animate: animate && this.#views.length === 1 });
    }
  }

  /**
   * The topmost view carrying an id, if any.
   * @param {string} id
   * @returns {NavView|null}
   */
  find(id) {
    for (let i = this.#views.length - 1; i >= 0; i -= 1) {
      if (this.#views[i].id === id) return this.#views[i];
    }
    return null;
  }

  /**
   * Pop views until `view` is gone, so a screen can dismiss itself even when
   * something else has since been pushed on top of it.
   * @param {NavView} view
   */
  async popTo(view) {
    for (let guard = this.#views.length; guard > 0 && this.#views.includes(view); guard -= 1) {
      await this.pop({ animate: this.top === view });
    }
  }

  /**
   * Silently drop a view that is not on top.
   *
   * Used when a screen is replaced rather than dismissed — pushing the new
   * character sheet, then retiring the old one from underneath it. Popping
   * would animate the wrong view away, since pop() always takes the top.
   * @param {NavView} view
   */
  remove(view) {
    const index = this.#views.indexOf(view);
    if (index === -1 || view === this.top) return;
    this.#views.splice(index, 1);
    view.detach();
  }

  /**
   * Pop whatever is stacked on top of `view`, leaving it exposed. Used when
   * an action should return to a screen that is already open rather than
   * pushing a second copy of it.
   * @param {NavView} view
   */
  async reveal(view) {
    if (!this.#views.includes(view)) return;
    for (let guard = this.#views.length; guard > 0 && this.top !== view; guard -= 1) {
      await this.pop({ animate: this.#views.at(-2) === view });
    }
  }

  /** @override */
  destroy() {
    for (const view of this.#views) view.detach();
    this.#views.length = 0;
    document.documentElement.removeAttribute(ROOT_ATTRS.DRAWER);
    super.destroy();
  }

  /* -- Back drag ------------------------------------------------------------ */

  /**
   * Interactive back gesture, owned by the stack rather than by each view so
   * the parallax stays in sync with the finger.
   * @param {NavView} view
   * @param {object} g Pan gesture event.
   */
  handleBackDrag(view, g) {
    if (view !== this.top || this.#animating) return;
    const below = this.#views.at(-2) ?? null;
    const width = view.element.getBoundingClientRect().width || window.innerWidth;

    if (g.phase === "began") {
      // `x - dx` is where the finger started; only the left edge drags back.
      view.dragging = (g.x - g.dx) <= BACK_EDGE;
      return;
    }
    if (!view.dragging) return;

    if (g.phase === "changed") {
      const dx = Math.max(0, g.dx);
      view.element.style.transform = `translateX(${dx}px)`;
      if (below) {
        const progress = Math.min(1, dx / width);
        below.element.style.transform = `translateX(-${PARALLAX * 100 * (1 - progress)}%)`;
      }
      return;
    }
    if (g.phase !== "ended" && g.phase !== "cancelled") return;

    view.dragging = false;
    const dx = Math.max(0, g.dx ?? 0);
    if (dx > width * BACK_FRACTION || (g.vx ?? 0) > BACK_VELOCITY) return void this.pop();

    // Not far enough: settle both views back where they were.
    Motion.slide(view.element, `translateX(${dx}px)`, "translateX(0)", { duration: DURATION.FAST })
      .then(() => { if (view.element?.isConnected) view.element.style.transform = ""; });
    if (below) {
      Motion.slide(below.element, below.element.style.transform || "translateX(0)", `translateX(-${PARALLAX * 100}%)`, { duration: DURATION.FAST });
    }
  }
}

/**
 * One screen on the stack. Callers fill `body` and keep the handle to pop it.
 */
export class NavView {
  /** @type {HTMLElement} */
  element;

  /** @type {HTMLElement} Content container the caller fills. */
  body;

  /** @type {HTMLElement|null} Default nav bar, when `chrome` is on. */
  bar = null;

  /** @type {string} */
  id;

  /** @type {boolean} A back-drag is in progress. */
  dragging = false;

  /** @type {NavStack} */
  #stack;

  /** @type {(() => void)|null} */
  #onPop;

  /** @type {(() => void)|null} Gesture unsubscriber. */
  #offDrag = null;

  /** @param {object} options */
  constructor({ stack, title, className, chrome, actions, id, onPop }) {
    const el = VelvetComponent.el;
    this.#stack = stack;
    this.#onPop = onPop;
    this.id = id;

    this.body = el("div", { cls: `${CLS}-nav-body` });
    const children = [];

    if (chrome) {
      const back = el("button", {
        cls: `${CLS}-nav-back`,
        attrs: { type: "button", "aria-label": game.i18n.localize(`${L10N}.Shell.Back`) },
        children: [VelvetComponent.icon("fa-solid fa-chevron-left")]
      });
      back.addEventListener("click", () => this.pop());
      this.bar = el("header", {
        cls: `${CLS}-nav-bar`,
        children: [
          back,
          el("h2", { cls: `${CLS}-nav-title`, text: title }),
          el("div", { cls: `${CLS}-nav-actions`, children: actions })
        ]
      });
      children.push(this.bar);
    }
    children.push(this.body);

    this.element = el("section", {
      cls: `${CLS}-nav-view ${className}`.trim(),
      attrs: { role: "dialog", "aria-label": title || undefined },
      children
    });
    // A view with no title still needs a valid element: drop the empty attr.
    if (!title) this.element.removeAttribute("aria-label");

    this.#offDrag = services.gestures?.on(this.element, "pan", (g) => stack.handleBackDrag(this, g)) ?? null;
  }

  /** Set the nav bar title after construction (an actor renamed, a live count). */
  set title(value) {
    const node = this.bar?.querySelector(`.${CLS}-nav-title`);
    if (node) node.textContent = value;
    if (value) this.element.setAttribute("aria-label", value);
  }

  /**
   * Mark this view as covered by another: inert to touch and invisible to
   * assistive tech, without unmounting it.
   * @param {boolean} covered
   */
  setCovered(covered) {
    this.element.classList.toggle(`${CLS}-under`, covered);
    this.element.inert = covered;
    if (covered) this.element.setAttribute("aria-hidden", "true");
    else this.element.removeAttribute("aria-hidden");
  }

  /** Pop this view, even if something was pushed above it. */
  pop() {
    return this.#stack.popTo(this);
  }

  /** Remove from the DOM and fire onPop exactly once. Called by the stack. */
  detach() {
    this.#offDrag?.();
    this.#offDrag = null;
    this.element.remove();
    const callback = this.#onPop;
    this.#onPop = null;
    callback?.();
  }
}
