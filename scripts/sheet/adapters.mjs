/**
 * Velvet Mobile — system adapter registry.
 *
 * Each adapter turns an Actor into a system-agnostic view model the
 * MobileSheet renders. Systems we know well (dnd5e, pf2e) get a hand-written
 * adapter; every other system falls through to the generic adapter, which
 * discovers what it can by shape. Only when even the generic adapter finds
 * nothing worth drawing do we return null, and the shell pins the system's
 * own sheet fullscreen instead.
 *
 * Other modules can teach us their system with `registerAdapter()`, exposed
 * on the public API as `api.sheet.registerAdapter`.
 *
 * View model shape:
 *   {
 *     subtitle: string,
 *     hp: { value, max, temp, bonus, pct, tempPct } | null,  // max is effective
 *     ac: number|string|null,
 *     stats: [{ label, value, onTap? }],
 *     applyHp: (delta) => Promise,            // damage spends temp HP first
 *     applyTempHp: ((value) => Promise)|null, // null where unsupported
 *     tabs: [{
 *       id, icon, label,
 *       sections: [{
 *         title?, badge?,
 *         type?: "abilities" | "conditions",
 *         abilities?: [{ key, label, mod, onTap?, onLong? }],
 *         conditions?: [{                  // type: "conditions" — chip cloud
 *           id, label, img?, active, value?,
 *           onTap,                         // toggle on/off
 *           onIncrease?, onDecrease?       // valued conditions, shown while on
 *         }],
 *         rows?: [{
 *           id, img?, label, sub?, badge?, prof?,
 *           cost?,                         // action cost, as the character
 *                                          // the system's action font draws
 *                                          // ("1", "2", "3", "R", "F")
 *           dim?,                          // present but not active today
 *           onTap?,                        // roll / use
 *           onLong?,                       // one specific secondary action
 *           menu?: [{ id, icon, label, onTap }],  // long-press action menu;
 *                                          // takes precedence over onLong
 *           actions?: [{ icon, label, onTap, active? }],  // active? = toggle
 *           description?: () => Promise<string>
 *         }]
 *       }]
 *     }]
 *   }
 *
 * @module sheet/adapters
 */

import { Logger } from "../core/logger.mjs";
import * as dnd5e from "./adapters/dnd5e.mjs";
import * as pf2e from "./adapters/pf2e.mjs";
import * as generic from "./adapters/generic.mjs";

/**
 * Registered per-system adapters, keyed by `game.system.id`.
 * @type {Map<string, { model: (actor: Actor) => object, types?: string[] }>}
 */
const ADAPTERS = new Map([
  ["dnd5e", { model: dnd5e.model, types: dnd5e.types }],
  ["pf2e", { model: pf2e.model, types: pf2e.types }],
  // Starfinder 2e is a fork of Pathfinder 2e that kept the data model whole —
  // it never even renamed the namespaces, still reading CONFIG.PF2E and
  // game.pf2e — so the PF2e adapter serves it unchanged. Its actor types
  // (character, npc) are a subset of the ones that adapter declares.
  ["sf2e", { model: pf2e.model, types: pf2e.types }]
]);

/**
 * Teach Velvet Mobile about a game system. Registering an id that already
 * has an adapter replaces it, which is how a system-specific companion
 * module can override our built-in support.
 *
 * @param {string} systemId            The `game.system.id` this adapter serves.
 * @param {object} adapter
 * @param {(actor: Actor) => object} adapter.model   Builds the view model.
 * @param {string[]} [adapter.types]   Actor types to handle; omit for all.
 * @returns {() => void}               Unregister.
 */
export function registerAdapter(systemId, { model, types } = {}) {
  if (typeof systemId !== "string" || !systemId) throw new Error("registerAdapter needs a system id");
  if (typeof model !== "function") throw new Error("registerAdapter needs a model(actor) function");
  const previous = ADAPTERS.get(systemId);
  ADAPTERS.set(systemId, { model, types });
  Logger.info(`Sheet adapter registered for system "${systemId}"`);
  return () => {
    if (ADAPTERS.get(systemId)?.model !== model) return;
    if (previous) ADAPTERS.set(systemId, previous);
    else ADAPTERS.delete(systemId);
  };
}

/** @returns {string[]} System ids with a dedicated adapter. */
export function registeredSystems() {
  return [...ADAPTERS.keys()];
}

/**
 * Whether a model is worth presenting. Tabs alone are not enough — an
 * adapter can emit a full tab bar whose sections are all empty (a familiar
 * with no skills, an actor whose getters all threw). A sheet of empty lists
 * is strictly worse than the system's own, so it has to actually contain
 * at least one row or ability cell. Condition chips deliberately do not
 * count: any actor can be offered the system's status effects, so a sheet
 * of nothing but conditions would always pass and never be worth showing.
 * @param {object|null} model
 * @returns {boolean}
 */
function hasContent(model) {
  return Boolean(model?.tabs?.some((tab) => tab.sections?.some(
    (section) => (section.rows?.length ?? 0) > 0 || (section.abilities?.length ?? 0) > 0
  )));
}

/**
 * Build the mobile view model for an actor, or null when nothing renderable
 * could be produced (the shell then pins the native sheet).
 * @param {Actor} actor
 * @returns {object|null}
 */
export function modelFor(actor) {
  if (!actor) return null;

  const adapter = ADAPTERS.get(game.system.id);
  const dedicated = adapter && (!adapter.types || adapter.types.includes(actor.type));

  try {
    let model = null;
    if (dedicated) {
      model = adapter.model(actor);
      if (!hasContent(model)) {
        Logger.warn(`Mobile sheet model for "${actor.name}" is empty — trying the generic adapter`);
        model = null;
      }
    }

    // Either no adapter claimed this actor, or the one that did came back
    // empty. The generic adapter works off data shape, so it usually still
    // has something — a partial mobile sheet beats a pinned desktop one.
    if (!model && generic.accepts(actor.type)) {
      const fallback = generic.model(actor);
      if (hasContent(fallback)) model = fallback;
    }

    if (!model) {
      Logger.warn(`No mobile sheet content for "${actor.name}" — using the native sheet`);
      return null;
    }
    return model;
  } catch (err) {
    Logger.error("Mobile sheet model failed — falling back to the native sheet", err);
    return null;
  }
}
