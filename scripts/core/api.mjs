/**
 * Velvet Mobile — public API.
 *
 * Exposed as `game.modules.get("velvet-mobile").api` and announced through
 * the `velvetMobile.ready` hook. Every namespace object is frozen; the API
 * only grows in minor versions and only breaks in major ones.
 *
 * @module core/api
 */

import { DEVICES, HOOKS, INPUTS, MODULE_ID, THEMES } from "./constants.mjs";
import { services } from "./services.mjs";
import { Theme } from "./theme.mjs";
import { BottomSheet } from "../components/bottom-sheet.mjs";
import { NavStack } from "../components/nav-stack.mjs";
import { VelvetComponent } from "../components/component.mjs";
import { registerAdapter, registeredSystems } from "../sheet/adapters.mjs";

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
    },
    /**
     * Teach Velvet Mobile how to render a game system's actors. Systems
     * without an adapter still get the generic one; register to replace it.
     * @param {string} systemId
     * @param {{ model: (actor: Actor) => object, types?: string[] }} adapter
     * @returns {() => void} Unregister.
     */
    registerAdapter(systemId, adapter) {
      return registerAdapter(systemId, adapter);
    },
    /** @returns {string[]} System ids with a dedicated adapter. */
    get systems() {
      return registeredSystems();
    }
  });

  const components = Object.freeze({
    VelvetComponent,
    /** The shell's own presentation mechanic: views pushed from the right. */
    NavStack,
    /** Still supported for modules that want a bottom-anchored panel. */
    BottomSheet
  });

  const theme = Object.freeze({
    /** @returns {string} The theme in force, never "auto". */
    get current() {
      return Theme.current;
    },
    /** Re-resolve and re-apply, e.g. after enabling a sheet module at runtime. */
    refresh() {
      Theme.apply();
    }
  });

  return Object.freeze({
    version: game.modules.get(MODULE_ID)?.version ?? "0.0.0",
    hooks: HOOKS,
    devices: DEVICES,
    themes: THEMES,
    device,
    state,
    gestures,
    sheet,
    theme,
    components
  });
}
