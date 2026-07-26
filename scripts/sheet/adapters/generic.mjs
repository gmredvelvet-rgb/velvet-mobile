/**
 * Velvet Mobile — generic, system-agnostic adapter.
 *
 * The fallback for every system without a dedicated adapter. It knows no
 * system-specific paths at all: it discovers hit points, a defence value,
 * ability-like and skill-like blocks by shape, and groups the actor's items
 * by their declared type. Taps route through the conventional item entry
 * points (`use` → `toMessage` → `roll`), so on most systems the sheet is
 * fully usable without anyone teaching us their data model.
 *
 * If it cannot find anything worth showing it returns a model with no tabs,
 * and the shell pins the system's own sheet fullscreen instead.
 *
 * @module sheet/adapters/generic
 */

import {
  acOf, attempt, describe, firstAt, hpOf, itemTypeLabel,
  makeApplyHp, num, safe, signed, t, text, titleCase, useItem
} from "./shared.mjs";

/** Actor types that are containers or scenery rather than a playable creature. */
const EXCLUDED_TYPES = new Set([
  "vehicle", "party", "group", "loot", "hazard", "encounter", "army",
  "shop", "container", "starship", "base", "faction", "organization"
]);

/** Where systems tend to keep ability-score-like blocks. */
const ABILITY_PATHS = Object.freeze([
  "system.abilities", "system.attributes", "system.stats",
  "system.characteristics", "system.traits.attributes", "system.scores"
]);

/** Where systems tend to keep skill-like blocks. */
const SKILL_PATHS = Object.freeze(["system.skills", "system.abilities.skills", "system.proficiencies"]);

/** Common places to look for a level or rank to put in the subtitle. */
const LEVEL_PATHS = Object.freeze([
  "system.details.level.value", "system.details.level", "system.level.value",
  "system.level", "system.attributes.level.value", "system.attributes.level"
]);

/**
 * Whether an actor type is plausibly a creature with a sheet worth drawing.
 * @param {string} type
 * @returns {boolean}
 */
export const accepts = (type) => !EXCLUDED_TYPES.has(String(type ?? "").toLowerCase());

/**
 * Pull a display number out of an entry that might be a raw number, or an
 * object with any of the usual field names.
 * @param {*} entry
 * @returns {number|null}
 */
function scoreOf(entry) {
  if (typeof entry === "number") return Number.isFinite(entry) ? entry : null;
  if (!entry || typeof entry !== "object") return null;
  return num(entry.mod, entry.total, entry.value, entry.rank, entry.score);
}

/**
 * Find the first block that looks like a set of ability scores: an object of
 * at least three entries that each resolve to a number.
 * @param {Actor} actor
 * @returns {Array<[string, *]>}
 */
function findScoreBlock(actor, paths) {
  for (const path of paths) {
    const block = firstAt(actor, [path]);
    if (!block || typeof block !== "object" || Array.isArray(block)) continue;
    const entries = Object.entries(block).filter(([, entry]) => scoreOf(entry) !== null);
    if (entries.length >= 3) return entries;
  }
  return [];
}

/** Prefer an entry's own label, then the system CONFIG, then the key. */
function entryLabel(entry, key, configBlock) {
  const own = text(entry?.label, entry?.name);
  if (own) {
    const localized = game.i18n.localize(own);
    return localized === own ? own : localized;
  }
  const fromConfig = configBlock?.[key];
  if (fromConfig) {
    const raw = typeof fromConfig === "string" ? fromConfig : text(fromConfig.label, fromConfig.name);
    if (raw) {
      const localized = game.i18n.localize(raw);
      return localized === raw ? raw : localized;
    }
  }
  return titleCase(key);
}

/** @param {Actor} actor @returns {object} */
export function model(actor) {
  const configBlock = CONFIG[String(game.system.id ?? "").toUpperCase()] ?? {};

  const subtitle = attempt("subtitle", () => {
    const level = firstAt(actor, LEVEL_PATHS);
    const parts = [titleCase(actor.type)];
    if (num(level) !== null) parts.push(`${t("Level")} ${num(level)}`);
    return parts.filter(Boolean).join(" · ");
  }, "");

  const abilities = attempt("abilities", () => findScoreBlock(actor, ABILITY_PATHS)
    .slice(0, 12)
    .map(([key, entry]) => ({
      key,
      label: entryLabel(entry, key, configBlock.abilities).slice(0, 4).toUpperCase(),
      // A raw score reads better unsigned; a derived modifier reads better signed.
      mod: typeof entry === "object" && num(entry.mod) !== null
        ? signed(num(entry.mod))
        : String(scoreOf(entry))
    })), []);

  const skills = attempt("skills", () => findScoreBlock(actor, SKILL_PATHS)
    .map(([key, entry]) => ({
      id: key,
      label: entryLabel(entry, key, configBlock.skills),
      badge: typeof entry === "object" && num(entry.mod, entry.total) !== null
        ? signed(num(entry.mod, entry.total))
        : String(scoreOf(entry))
    }))
    .sort((a, b) => a.label.localeCompare(b.label)), []);

  /* Every item the actor owns, grouped by its declared type — the only
     classification a system is guaranteed to give us. */
  const itemSections = attempt("items", () => {
    const byType = new Map();
    for (const item of actor.items?.contents ?? []) {
      if (!byType.has(item.type)) byType.set(item.type, []);
      byType.get(item.type).push(item);
    }
    return [...byType.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([type, items]) => ({
        title: itemTypeLabel(type),
        badge: String(items.length),
        rows: items
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((item) => {
            const quantity = num(item.system?.quantity);
            return {
              id: item.id,
              img: item.img,
              label: item.name,
              badge: quantity !== null && quantity !== 1 ? `×${quantity}` : "",
              onTap: safe(() => useItem(actor, item)),
              description: describe(item)
            };
          })
      }));
  }, []);

  const tabs = [];
  if (abilities.length || skills.length) {
    tabs.push({
      id: "stats",
      icon: "fa-solid fa-user",
      label: t("TabStats"),
      sections: [
        ...(abilities.length ? [{ type: "abilities", abilities }] : []),
        ...(skills.length ? [{ title: t("Skills"), rows: skills }] : [])
      ]
    });
  }
  if (itemSections.length) {
    tabs.push({
      id: "items",
      icon: "fa-solid fa-sack",
      label: t("TabItems"),
      sections: itemSections
    });
  }

  return {
    subtitle,
    hp: hpOf(actor),
    ac: acOf(actor),
    applyHp: makeApplyHp(actor),
    stats: [],
    tabs
  };
}
