/**
 * Velvet Mobile — UI state projector.
 *
 * Sole writer of the JS→CSS contract: `data-vm-*` attributes and inline
 * custom properties on `<html>`. All visual adaptation lives in CSS keyed
 * off these outputs; no other file may touch element styles for layout.
 *
 * @module responsive/ui-state
 */

import { CSS_VARS, DEVICES, ROOT_ATTRS } from "../core/constants.mjs";

export class UIState {
  /**
   * Project a device profile onto the document root.
   * @param {import("./device-profiler.mjs").DeviceProfile} profile
   */
  static apply(profile) {
    const root = document.documentElement;
    const mobile = profile.device !== DEVICES.DESKTOP;

    root.toggleAttribute(ROOT_ATTRS.ACTIVE, mobile);
    root.setAttribute(ROOT_ATTRS.DEVICE, profile.device);
    root.setAttribute(ROOT_ATTRS.INPUT, profile.input);
    root.setAttribute(ROOT_ATTRS.ORIENTATION, profile.orientation);
    root.setAttribute(ROOT_ATTRS.SIZE, profile.size);

    // Keyboard-aware height: layouts anchored to --vm-vvh stay visible when
    // the on-screen keyboard shrinks the visual viewport (the broken-100vh fix).
    root.style.setProperty(CSS_VARS.VISUAL_HEIGHT, `${profile.viewport.visualHeight}px`);
    const keyboardInset = Math.max(0, profile.viewport.height - profile.viewport.visualHeight);
    root.style.setProperty(CSS_VARS.KEYBOARD_INSET, `${keyboardInset}px`);
  }

  /**
   * Write the user's UI scale factor.
   * @param {number} scale
   */
  static setScale(scale) {
    document.documentElement.style.setProperty(CSS_VARS.SCALE, String(scale));
  }

  /** Remove every attribute and property this class ever wrote. */
  static clear() {
    const root = document.documentElement;
    for (const attr of Object.values(ROOT_ATTRS)) root.removeAttribute(attr);
    for (const cssVar of Object.values(CSS_VARS)) root.style.removeProperty(cssVar);
  }
}
