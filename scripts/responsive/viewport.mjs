/**
 * Velvet Mobile — viewport service.
 *
 * Behavioral (non-visual) fixes that require touching the document once:
 *  - `viewport-fit=cover` so `env(safe-area-inset-*)` works on notched
 *    devices and the UI can extend under rounded corners deliberately.
 *
 * Everything visual (touch-action, input font-size, overscroll) lives in
 * `styles/base.css`, gated by the `data-vm-*` attributes — CSS-first rule.
 *
 * @module responsive/viewport
 */

import { DEVICES } from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";

export class ViewportService {
  /** @type {string} */
  name = "viewport";

  /** @type {string|null} Original meta content, restored on disable. */
  #originalContent = null;

  /** @type {MutationObserver|null} Watches for the resolution warning. */
  #observer = null;

  /**
   * @param {import("./device-profiler.mjs").DeviceProfile} profile
   * @returns {boolean}
   */
  shouldEnable(profile) {
    return profile.device !== DEVICES.DESKTOP;
  }

  /** Patch the viewport meta tag, preserving whatever core declared. */
  enable() {
    this.#suppressResolutionWarning();
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) {
      Logger.warn("No viewport meta tag found; skipping viewport-fit patch");
      return;
    }
    this.#originalContent = meta.getAttribute("content") ?? "";
    if (this.#originalContent.includes("viewport-fit")) return;
    meta.setAttribute("content", `${this.#originalContent}, viewport-fit=cover`);
  }

  /** Restore the original viewport meta content. */
  disable() {
    this.#observer?.disconnect();
    this.#observer = null;
    if (this.#originalContent === null) return;
    document.querySelector('meta[name="viewport"]')
      ?.setAttribute("content", this.#originalContent);
    this.#originalContent = null;
  }

  /**
   * Foundry warns that the window is below 1024x768 — permanently true on a
   * phone, and the banner buries every useful notification. Drop it as it
   * appears; everything else is left alone.
   */
  #suppressResolutionWarning() {
    const notifications = document.getElementById("notifications");
    if (!notifications) return;

    const isResolutionWarning = (node) => {
      const text = node.textContent ?? "";
      return text.includes("1024px") || text.includes("768px") || text.includes("zoom factor");
    };
    const drop = (node) => {
      if (node.nodeType === Node.ELEMENT_NODE && isResolutionWarning(node)) node.remove();
    };

    for (const node of [...notifications.children]) drop(node);
    this.#observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) for (const node of mutation.addedNodes) drop(node);
    });
    this.#observer.observe(notifications, { childList: true });
  }
}
