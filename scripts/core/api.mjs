/**
 * Velvet Mobile — public API.
 *
 * Exposed as `game.modules.get("velvet-mobile").api` and announced through
 * the `velvetMobile.ready` hook. Every namespace object is frozen; the API
 * only grows in minor versions and only breaks in major ones.
 *
 * @module core/api
 */

import { DEVICES, HOOKS, INPUTS, MODULE_ID } from "./constants.mjs";
import { services } from "./services.mjs";
import { BottomSheet } from "../components/bottom-sheet.mjs";
import { VelvetComponent } from "../components/component.mjs";

/**
 * Build the frozen API object.
 * @param {object} deps
 * @param {() => boolean} deps.isActive   Whether mobile mode is currently active.
 * @returns {Readonly<object>}
 */
export function createAPI({ isActive }) {
  const device = Object.freeze({
    /** @returns {Readonly<object>|null} The current immutable device profile. */
    get profile() {
      return services.profiler?.profile ?? null;
    },

    /**
     * Convenience predicate over the current profile.
     * @param {"phone"|"tablet"|"desktop"|"touch"} what
     * @returns {boolean}
     */
    is(what) {
      const p = services.profiler?.profile;
      if (!p) return false;
      if (what === "touch") return p.input !== INPUTS.MOUSE;
      return p.device === what;
    }
  });

  const state = Object.freeze({
    /** @returns {boolean} True when the mobile experience is active on this client. */
    get active() {
      return isActive();
    }
  });

  const gestures = Object.freeze({
    /**
     * Observe a gesture. See gestures/recognizers.mjs for options.
     * @returns {() => void} Unsubscribe.
     */
    on(element, type, handler, options) {
      if (!services.gestures) throw new Error("Velvet Mobile gestures are not available");
      return services.gestures.on(element, type, handler, options);
    }
  });

  const sheet = Object.freeze({
    /** @returns {Actor|null} The actor currently pinned fullscreen. */
    get actor() {
      return services.shell?.actor ?? null;
    },
    /** Pin a different owned actor. @param {string} actorId */
    open(actorId) {
      services.shell?.selectActor(actorId);
    },
    /** Open the chat panel. */
    openChat() {
      services.shell?.openChat();
    },
    /** Close the chat panel. */
    closeChat() {
      services.shell?.closeChat();
    }
  });

  const components = Object.freeze({
    VelvetComponent,
    BottomSheet
  });

  return Object.freeze({
    version: game.modules.get(MODULE_ID)?.version ?? "0.0.0",
    hooks: HOOKS,
    devices: DEVICES,
    device,
    state,
    gestures,
    sheet,
    components
  });
}
