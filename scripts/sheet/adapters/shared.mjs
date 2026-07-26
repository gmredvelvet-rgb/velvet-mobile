/**
 * Velvet Mobile — shared adapter helpers.
 *
 * Everything in here is system-agnostic: no adapter may reach for a system's
 * data model through these helpers without going through a documented path
 * list, so a system we have never heard of degrades instead of throwing.
 *
 * @module sheet/adapters/shared
 */

import { L10N } from "../../core/constants.mjs";
import { Logger } from "../../core/logger.mjs";

/** Localize a `VELVETMOBILE.Sheet.*` key. @param {string} key @returns {string} */
export const t = (key) => game.i18n.localize(`${L10N}.Sheet.${key}`);

/** Signed modifier string. @param {number} n @returns {string} */
export const signed = (n) => {
  const value = Number(n);
  if (!Number.isFinite(value)) return "";
  return `${value >= 0 ? "+" : ""}${value}`;
};

/** First finite number in the list, or `fallback`. @returns {number|null} */
export const num = (...values) => {
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

/** First non-empty string in the list. @returns {string} */
export const text = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
};

/** Title-case a slug or trait. @param {string} value @returns {string} */
export const titleCase = (value) => String(value ?? "")
  .replace(/[-_]+/g, " ")
  .replace(/\b\w/g, (c) => c.toUpperCase())
  .trim();

/**
 * CONFIG label entries are plain strings in old systems and objects in new
 * ones; either way we want a localized display string.
 * @param {*} entry
 * @param {string} fallback
 * @returns {string}
 */
export const labelOf = (entry, fallback) => {
  if (!entry) return fallback;
  const raw = typeof entry === "string" ? entry : (entry.label ?? entry.name);
  return raw ? game.i18n.localize(raw) : fallback;
};

/** Localize when the value looks like an i18n key, otherwise pass it through. */
export const maybeLocalize = (value, fallback = "") => {
  const raw = text(value);
  if (!raw) return fallback;
  if (!/^[A-Z][\w-]*(\.[\w-]+)+$/.test(raw)) return raw;
  const localized = game.i18n.localize(raw);
  return localized === raw ? fallback || raw : localized;
};

/** `foundry.utils.getProperty` with a hard guard for pre-v10 shims. */
export const at = (object, path) => {
  try {
    return foundry.utils.getProperty(object, path);
  } catch {
    return undefined;
  }
};

/**
 * Walk a list of candidate paths and return the first defined value.
 * @param {object} root
 * @param {string[]} paths
 * @returns {*}
 */
export const firstAt = (root, paths) => {
  for (const path of paths) {
    const value = at(root, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
};

/** Wrap a roll callback so one broken roll never kills the sheet. */
export const safe = (fn) => async (...args) => {
  try {
    return await fn(...args);
  } catch (err) {
    Logger.error("Roll failed", err);
    ui.notifications?.warn(err?.message ?? String(err));
  }
};

/**
 * Run one extractor section; a broken section degrades to its fallback
 * instead of taking the whole mobile sheet down with it.
 * @template T
 * @param {string} label
 * @param {() => T} fn
 * @param {T} fallback
 * @returns {T}
 */
export const attempt = (label, fn, fallback) => {
  try {
    return fn();
  } catch (err) {
    Logger.error(`Mobile sheet: "${label}" section failed`, err);
    return fallback;
  }
};

/** Candidate paths for a creature's hit points, most systems first. */
export const HP_PATHS = Object.freeze([
  "system.attributes.hp",
  "system.hp",
  "system.health",
  "system.attributes.health",
  "system.resources.hp",
  "system.stats.hp",
  "system.derived.hp",
  "system.combat.hp"
]);

/** Candidate paths for armour class / defence. */
export const AC_PATHS = Object.freeze([
  "system.attributes.ac.value",
  "system.attributes.ac",
  "system.ac.value",
  "system.ac",
  "system.defenses.ac.value",
  "system.armor.value",
  "system.attributes.armor.value",
  "system.stats.ac.value"
]);

/**
 * Locate the actor's HP object without knowing the system.
 * @param {Actor} actor
 * @returns {{ path: string, data: object }|null}
 */
export const findHp = (actor) => {
  for (const path of HP_PATHS) {
    const data = at(actor, path);
    if (!data || typeof data !== "object") continue;
    const max = num(data.max, data.total, data.maximum);
    const value = num(data.value, data.current);
    if (max === null || max <= 0 || value === null) continue;
    return { path, data };
  }
  return null;
};

/**
 * System-agnostic HP block for the header bar.
 * @param {Actor} actor
 * @returns {{value:number,max:number,temp:number,pct:number}|null}
 */
export const hpOf = (actor) => {
  const found = findHp(actor);
  if (!found) return null;
  const hp = found.data;
  const max = num(hp.max, hp.total, hp.maximum) ?? 0;
  const value = num(hp.value, hp.current) ?? 0;
  const temp = num(hp.temp, hp.tempValue, hp.temporary) ?? 0;
  return {
    value,
    max,
    temp,
    pct: max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0
  };
};

/** System-agnostic AC lookup. @param {Actor} actor @returns {number|string|null} */
export const acOf = (actor) => {
  const raw = firstAt(actor, AC_PATHS);
  if (raw === undefined || raw === null) return null;
  if (typeof raw === "object") return num(raw.value, raw.total) ?? null;
  if (typeof raw === "number" || typeof raw === "string") return raw;
  return null;
};

/**
 * Clamp-update the actor's HP through whichever path this system uses.
 * Works on dnd5e, pf2e and anything else with a `{value, max}` HP object.
 * @param {Actor} actor
 * @returns {(delta:number) => Promise<void>}
 */
export const makeApplyHp = (actor) => async (delta) => {
  const found = findHp(actor);
  if (!found) return;
  const hp = found.data;
  const max = num(hp.max, hp.total, hp.maximum) ?? 0;
  const current = num(hp.value, hp.current) ?? 0;
  const key = hp.value !== undefined ? "value" : "current";
  const next = Math.max(0, Math.min(max, current + delta));
  if (next === current) return;
  await actor.update({ [`${found.path}.${key}`]: next });
};

/** Lazy enriched description for an item row. @param {Item} item */
export const describe = (item) => async () => {
  const source = text(
    item.system?.description?.value,
    item.system?.description,
    item.system?.details?.description,
    item.system?.notes
  );
  if (!source) return "";
  try {
    const enricher = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    return await enricher.enrichHTML(source, {
      relativeTo: item,
      rollData: item.getRollData?.() ?? {},
      secrets: false
    });
  } catch {
    return source;
  }
};

/**
 * Best-effort "use this item" for a system we do not have an adapter for.
 * Tries the conventional entry points in order of specificity, and finally
 * announces the item in chat so the tap is never a no-op.
 * @param {Actor} actor
 * @param {Item} item
 * @returns {Promise<*>}
 */
export const useItem = async (actor, item) => {
  if (typeof item.use === "function") return item.use();
  if (typeof item.toMessage === "function") return item.toMessage();
  if (typeof item.toChat === "function") return item.toChat();
  if (typeof item.roll === "function") return item.roll();
  if (typeof item.displayCard === "function") return item.displayCard();
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong>: ${foundry.utils.escapeHTML(item.name)}</p>`
  });
};

/** Localized label for an item type, via the core type-label registry. */
export const itemTypeLabel = (type) => {
  const key = CONFIG.Item?.typeLabels?.[type];
  return key ? game.i18n.localize(key) : titleCase(type);
};
