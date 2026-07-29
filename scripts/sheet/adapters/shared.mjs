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

/** Field names systems use for temporary hit points. */
const TEMP_KEYS = Object.freeze(["temp", "tempValue", "temporary"]);

/** Field names for a bonus to the hit point maximum. */
const TEMP_MAX_KEYS = Object.freeze(["tempmax", "tempMax", "bonusMax"]);

/** The key an HP object actually uses for a field, or the first candidate. */
const keyIn = (hp, keys) => keys.find((key) => hp?.[key] !== undefined) ?? keys[0];

/**
 * The maximum a creature can actually be healed to. A bonus to the maximum
 * is a separate field in most systems — dnd5e's `tempmax` — and some derive
 * the total for us. Reading only `max` understates the bar for anyone under
 * an Aid spell or a similar effect.
 * @param {object} hp
 * @returns {number}
 */
const effectiveMaxOf = (hp) => {
  const derived = num(hp.effectiveMax);
  if (derived !== null) return derived;
  const base = num(hp.max, hp.total, hp.maximum) ?? 0;
  return base + (num(...TEMP_MAX_KEYS.map((key) => hp[key])) ?? 0);
};

/**
 * System-agnostic HP block for the header bar. `max` is the effective
 * maximum, bonus included, so the bar and the heal clamp agree with it.
 *
 * `tempPct` is sized against the same scale as `pct` so the bar can draw the
 * shield as a band sitting on top of real hit points — temporary hit points
 * are damage you get to ignore, and a number in brackets does not read that
 * way at a glance. It is capped so a large shield cannot run off the bar.
 *
 * @param {Actor} actor
 * @returns {{value:number,max:number,temp:number,bonus:number,pct:number,tempPct:number}|null}
 */
export const hpOf = (actor) => {
  const found = findHp(actor);
  if (!found) return null;
  const hp = found.data;
  const max = effectiveMaxOf(hp);
  const base = num(hp.max, hp.total, hp.maximum) ?? 0;
  const value = num(hp.value, hp.current) ?? 0;
  const temp = num(...TEMP_KEYS.map((key) => hp[key])) ?? 0;
  const pct = max > 0 ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0;
  return {
    value,
    max,
    temp,
    // What the maximum gained (or lost) beyond the creature's own.
    bonus: max - base,
    pct,
    tempPct: max > 0 && temp > 0
      ? Math.max(0, Math.min(100 - pct, Math.round((temp / max) * 100)))
      : 0
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
 *
 * Damage comes off temporary hit points first, which is what every system
 * that has them rules — spending real hit points while a shield is up is a
 * silent corruption of the character, not a rounding difference. Healing
 * never touches them: temporary hit points are not healed, they are granted.
 *
 * @param {Actor} actor
 * @returns {(delta:number) => Promise<void>}
 */
export const makeApplyHp = (actor) => async (delta) => {
  const found = findHp(actor);
  if (!found) return;
  const hp = found.data;
  const max = effectiveMaxOf(hp);
  const current = num(hp.value, hp.current) ?? 0;
  const valueKey = hp.value !== undefined ? "value" : "current";
  const tempKey = keyIn(hp, TEMP_KEYS);
  const temp = num(...TEMP_KEYS.map((key) => hp[key])) ?? 0;

  const update = {};
  let remaining = delta;
  if (delta < 0 && temp > 0) {
    const absorbed = Math.min(temp, -delta);
    update[`${found.path}.${tempKey}`] = temp - absorbed;
    remaining = delta + absorbed;
  }

  const next = Math.max(0, Math.min(max, current + remaining));
  if (next !== current) update[`${found.path}.${valueKey}`] = next;
  if (!Object.keys(update).length) return;
  await actor.update(update);
};

/**
 * Grant temporary hit points. They replace rather than stack — the rule in
 * every system that has them, and what the desktop sheets do.
 * @param {Actor} actor
 * @returns {((value:number) => Promise<void>)|null} Null when the system has
 *   no temporary hit points to grant.
 */
export const makeApplyTempHp = (actor) => {
  const found = findHp(actor);
  if (!found) return null;
  // Only offer this where the system actually models it: writing a `temp`
  // key into an HP object that has none invents a field nothing reads.
  if (!TEMP_KEYS.some((key) => found.data[key] !== undefined)) return null;
  const tempKey = keyIn(found.data, TEMP_KEYS);
  return async (value) => {
    const next = Math.max(0, Math.round(value));
    await actor.update({ [`${found.path}.${tempKey}`]: next });
  };
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

/* -- Durations ------------------------------------------------------------- */

/**
 * Seconds per unit, largest first. A round is six seconds in both D&D 5e and
 * Pathfinder 2e, which is what makes a single scale work for either.
 */
export const DURATION_UNITS = Object.freeze([
  [86400, "UnitDays"],
  [3600, "UnitHours"],
  [60, "UnitMinutes"],
  [6, "UnitRounds"]
]);

/**
 * How much longer something lasts, as a short readable string.
 *
 * Counted from `from` — the unit the effect was written in — rather than the
 * largest that divides evenly: ten rounds of Bless reads "10 rds", not
 * "1 min", because a player counting turns needs rounds. It drops a unit only
 * once the declared one falls below one, so half an hour left on an hour-long
 * buff reads "30 min" rather than "0 h".
 *
 * @param {number} seconds
 * @param {object} [options]
 * @param {string} [options.from]  Declared unit ("rounds", "hours"…).
 * @returns {string} Empty when the duration is not a finite number of seconds.
 */
export function formatDuration(seconds, { from = "" } = {}) {
  const total = num(seconds);
  if (total === null || !Number.isFinite(total)) return "";
  if (total <= 0) return t("Expired");
  const key = from ? `unit${String(from).toLowerCase()}` : "";
  const declared = DURATION_UNITS.findIndex(([, unit]) => unit.toLowerCase() === key);
  for (const [size, unit] of DURATION_UNITS.slice(Math.max(0, declared))) {
    const count = Math.floor(total / size);
    if (count >= 1) return `${count} ${t(unit)}`;
  }
  return `${Math.ceil(total)} ${t("UnitSeconds")}`;
}

/* -- Rests ----------------------------------------------------------------- */

/**
 * Rows for the rest actions a system offers, dropping any the actor cannot
 * actually perform. Each entry is `{ id, label, icon, available, onTap }`.
 * @param {object[]} rests
 * @returns {object[]}
 */
export const restRows = (rests) => rests
  .filter((rest) => rest?.available)
  .map((rest) => ({ id: rest.id, img: rest.icon, label: rest.label, onTap: rest.onTap }));

/**
 * A rest section, or nothing when the system offers none. Adapters spread
 * the result so an empty list leaves no heading behind.
 * @param {object[]} rows
 * @returns {object[]} Zero or one section.
 */
export const restSection = (rows) => (rows.length ? [{ title: t("Rest"), rows }] : []);

/* -- Row menu -------------------------------------------------------------- */

/**
 * Post an item to chat without spending it.
 *
 * Deliberately not `useItem`: a tap already uses the item, and a player who
 * long-presses to read a description must not lose a charge for it. Systems
 * expose a display-only card under different names, so try each before
 * falling back to a plain message carrying the description.
 *
 * @param {Actor} actor
 * @param {Item} item
 * @returns {Promise<*>}
 */
export const sendToChat = async (actor, item) => {
  if (typeof item.displayCard === "function") return item.displayCard();
  if (typeof item.toMessage === "function") return item.toMessage();
  if (typeof item.toChat === "function") return item.toChat();
  const description = await describe(item)();
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<h3>${foundry.utils.escapeHTML(item.name)}</h3>${description}`
  });
};

/**
 * The long-press menu for an item row: the things the desktop sheet offers
 * on right-click, minus anything destructive. Deleting an item is not an
 * action anyone should be one mis-press away from on a phone.
 *
 * @param {Actor} actor
 * @param {Item} item
 * @param {object[]} [extras]  System-specific entries, placed after "chat".
 * @returns {object[]} Menu entries, or none when there is nothing to offer.
 */
export const itemMenu = (actor, item, extras = []) => {
  if (!item) return [];
  const entries = [{
    id: "chat",
    icon: "fa-solid fa-comment",
    label: t("SendToChat"),
    onTap: safe(() => sendToChat(actor, item))
  }];
  entries.push(...extras.filter(Boolean));
  // Editing needs both a sheet to open and the right to change the item.
  if (item.isOwner && item.sheet) {
    entries.push({
      id: "edit",
      icon: "fa-solid fa-pen-to-square",
      label: t("Edit"),
      onTap: safe(async () => item.sheet.render(true))
    });
  }
  return entries;
};

/** Localized label for an item type, via the core type-label registry. */
export const itemTypeLabel = (type) => {
  const key = CONFIG.Item?.typeLabels?.[type];
  return key ? game.i18n.localize(key) : titleCase(type);
};

/* -- Conditions ------------------------------------------------------------ */

/**
 * The status effects worth offering as chips: whatever the system registered
 * for the token HUD, minus the ones it asked to keep out of it. Field names
 * moved in v12 (`label`/`icon` → `name`/`img`), so both are read.
 * @returns {Array<{id:string,label:string,img:string}>}
 */
const statusEffectCatalogue = () => (CONFIG.statusEffects ?? [])
  .filter((effect) => effect?.id && effect.hud !== false)
  .map((effect) => ({
    id: effect.id,
    label: maybeLocalize(text(effect.name, effect.label), titleCase(effect.id)),
    img: text(effect.img, effect.icon)
  }));

/**
 * Order chips for a thumb: the ones currently on first, then the rest
 * alphabetically. Toggling reflows the cloud once, which is the feedback
 * you want — the alternative is hunting for two lit chips in a list of forty.
 * @template {{label:string, active:boolean}} T
 * @param {T[]} conditions
 * @returns {T[]}
 */
export const sortConditions = (conditions) => [...conditions].sort((a, b) => {
  if (a.active !== b.active) return a.active ? -1 : 1;
  return a.label.localeCompare(b.label);
});

/**
 * System-agnostic condition chips, built on core's status effect registry.
 * Works on any system that populates `CONFIG.statusEffects` — which is every
 * system, because Foundry ships a default set — and toggles through the core
 * `Actor#toggleStatusEffect` API rather than touching effects directly.
 *
 * Returns an empty list for actors the user cannot modify: a chip that always
 * fails on the server is worse than no chip at all.
 *
 * @param {Actor} actor
 * @returns {Array<object>} Chips for a `type: "conditions"` section.
 */
export const conditionsOf = (actor) => {
  if (!actor?.isOwner || typeof actor.toggleStatusEffect !== "function") return [];
  const active = actor.statuses instanceof Set ? actor.statuses : new Set();
  return sortConditions(statusEffectCatalogue().map((effect) => ({
    id: effect.id,
    label: effect.label,
    img: effect.img,
    active: active.has(effect.id),
    value: null,
    onTap: safe(() => actor.toggleStatusEffect(effect.id))
  })));
};

/**
 * A conditions section, or nothing when there is none to offer. Adapters
 * spread the result so an empty catalogue leaves no heading behind.
 * @param {Array<object>} conditions
 * @returns {Array<object>} Zero or one section.
 */
export const conditionsSection = (conditions) => {
  if (!conditions.length) return [];
  const on = conditions.filter((condition) => condition.active).length;
  return [{
    type: "conditions",
    title: t("Conditions"),
    badge: on ? String(on) : "",
    conditions
  }];
};
