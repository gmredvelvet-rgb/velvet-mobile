/**
 * Velvet Mobile — settings view model.
 *
 * Turns Foundry's settings registry into something a phone can render, with
 * no DOM in sight so it can be reasoned about (and tested) on its own.
 *
 * The rules for *which* settings a user may see are Foundry's, not ours, and
 * are mirrored from `SettingsConfig#_prepareCategoryData`: a setting has to be
 * marked `config`, world-scoped settings need the SETTINGS_MODIFY permission,
 * and restricted menus need it too. Showing a control the server will refuse
 * is worse than not showing it.
 *
 * @module shell/settings-model
 */

import { Logger } from "../core/logger.mjs";

/** Control kinds the mobile settings screen knows how to draw. */
export const CONTROL = Object.freeze({
  TOGGLE: "toggle",
  SELECT: "select",
  SLIDER: "slider",
  NUMBER: "number",
  TEXT: "text",
  FILE: "file",
  /** Something we cannot draw safely — a DataModel, an exotic DataField. */
  UNSUPPORTED: "unsupported"
});

/** @returns {object} Foundry's field classes, or an empty set if unavailable. */
const fieldClasses = () => foundry?.data?.fields ?? {};

/** Whether `value` is an instance of a named Foundry field class. */
const isField = (value, name) => {
  const cls = fieldClasses()[name];
  return Boolean(cls) && value instanceof cls;
};

/**
 * A non-empty choices map, or null. Foundry accepts both a plain object and
 * (on DataFields) a function returning one.
 * @param {*} choices
 * @returns {Record<string, string>|null}
 */
function normalizeChoices(choices) {
  let raw = choices;
  if (typeof raw === "function") {
    try {
      raw = raw();
    } catch (err) {
      Logger.debug("Setting choices function threw", err);
      return null;
    }
  }
  if (Array.isArray(raw)) {
    // Array form: the value is the entry itself.
    return raw.length ? Object.fromEntries(raw.map((entry) => [entry, String(entry)])) : null;
  }
  if (!raw || typeof raw !== "object") return null;
  const entries = Object.entries(raw);
  return entries.length ? Object.fromEntries(entries) : null;
}

/**
 * Decide how to draw one setting.
 *
 * Choices win over everything: a setting with a choice map is a picker
 * whatever its underlying type, which is how Foundry treats it too.
 *
 * @param {object} setting  A `game.settings.settings` entry.
 * @returns {{control: string, choices: object|null, range: object|null}}
 */
function controlFor(setting) {
  const type = setting?.type;
  const fromField = isField(type, "DataField") ? type : null;
  const choices = normalizeChoices(setting?.choices ?? fromField?.choices);
  if (choices) return { control: CONTROL.SELECT, choices, range: null };

  if (setting?.filePicker) return { control: CONTROL.FILE, choices: null, range: null };

  if (type === Boolean || isField(type, "BooleanField")) {
    return { control: CONTROL.TOGGLE, choices: null, range: null };
  }

  if (type === Number || isField(type, "NumberField")) {
    const range = setting.range ?? rangeOfField(fromField);
    // A slider needs both ends to mean anything; an open-ended number is a
    // keypad, not a track.
    if (range && Number.isFinite(range.min) && Number.isFinite(range.max)) {
      return { control: CONTROL.SLIDER, choices: null, range: { step: 1, ...range } };
    }
    return { control: CONTROL.NUMBER, choices: null, range: null };
  }

  if (isField(type, "FilePathField")) return { control: CONTROL.FILE, choices: null, range: null };
  if (type === String || isField(type, "StringField")) {
    return { control: CONTROL.TEXT, choices: null, range: null };
  }

  // No type at all means Foundry stores it verbatim; a string box is the
  // honest default and matches what core does.
  if (type === undefined || type === null) return { control: CONTROL.TEXT, choices: null, range: null };

  return { control: CONTROL.UNSUPPORTED, choices: null, range: null };
}

/** Min/max/step carried on a NumberField rather than in `range`. */
function rangeOfField(field) {
  if (!field) return null;
  const { min, max, step } = field;
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  return { min, max, step: Number.isFinite(step) ? step : 1 };
}

/**
 * Which package a namespace belongs to, and what to call it. Mirrors
 * `SettingsConfig#_categorizeEntry` so our grouping matches the desktop's.
 * @param {string} namespace
 * @returns {{id: string, label: string}}
 */
function categoryOf(namespace) {
  if (namespace === "core") return { id: "core", label: game.i18n.localize("PACKAGECONFIG.TABS.core") };
  if (namespace === game.system?.id) return { id: "system", label: game.system.title };
  const module = game.modules?.get(namespace);
  if (module) return { id: module.id, label: module.title };
  return { id: "unmapped", label: game.i18n.localize("PACKAGECONFIG.TABS.unmapped") };
}

/** Localize a label that may or may not be an i18n key. */
const label = (value) => (value ? game.i18n.localize(value) : "");

/**
 * Every setting and submenu the current user is allowed to configure,
 * grouped by package, in the desktop's order: core, then the system, then
 * modules alphabetically.
 *
 * @returns {Array<{id: string, label: string, entries: object[]}>}
 */
export function settingsCategories() {
  const canConfigure = game.user?.can?.("SETTINGS_MODIFY") ?? false;
  const categories = new Map();
  const bucket = (namespace) => {
    const { id, label: name } = categoryOf(namespace);
    if (!categories.has(id)) categories.set(id, { id, label: name, entries: [] });
    return categories.get(id);
  };

  for (const entry of menuEntries(canConfigure)) bucket(entry.namespace).entries.push(entry);
  for (const entry of settingEntries(canConfigure)) bucket(entry.namespace).entries.push(entry);

  return [...categories.values()]
    .filter((category) => category.entries.length)
    .sort((a, b) => categoryRank(a.id) - categoryRank(b.id) || a.label.localeCompare(b.label));
}

/** Core first, then the game system, then modules. @param {string} id */
function categoryRank(id) {
  if (id === "core") return 0;
  if (id === "system") return 1;
  return 2;
}

/**
 * Submenu entries the user may open.
 * @param {boolean} canConfigure
 * @returns {object[]}
 */
function menuEntries(canConfigure) {
  const entries = [];
  for (const menu of game.settings?.menus?.values() ?? []) {
    if (menu.restricted && !canConfigure) continue;
    // Core's own carve-out: permissions are for the gamemaster alone.
    if (menu.key === "core.permissions" && !game.user?.hasRole?.("GAMEMASTER")) continue;
    entries.push({
      kind: "menu",
      // `registerMenu` stores `key` already qualified as "namespace.key" and
      // keys the registry by it, so this is both the id and the lookup key.
      // Re-qualifying it here would double the namespace and the menu would
      // never open.
      id: menu.key,
      key: menu.key,
      namespace: menu.namespace,
      icon: menu.icon,
      label: label(menu.name) || menu.key,
      hint: label(menu.hint),
      buttonText: label(menu.label)
    });
  }
  return entries;
}

/**
 * Settings the user may change, with their current values resolved.
 * @param {boolean} canConfigure
 * @returns {object[]}
 */
function settingEntries(canConfigure) {
  const entries = [];
  for (const setting of game.settings?.settings?.values() ?? []) {
    if (!setting.config) continue;
    if (!canConfigure && setting.scope === "world") continue;
    let value;
    try {
      value = game.settings.get(setting.namespace, setting.key);
    } catch (err) {
      // A setting registered but never stored, or one whose type refuses to
      // cast: skip it rather than take the whole screen down.
      Logger.debug(`Could not read setting ${setting.namespace}.${setting.key}`, err);
      continue;
    }
    const { control, choices, range } = controlFor(setting);
    entries.push({
      kind: "setting",
      id: `${setting.namespace}.${setting.key}`,
      namespace: setting.namespace,
      key: setting.key,
      label: label(setting.name) || setting.key,
      hint: label(setting.hint),
      scope: setting.scope,
      requiresReload: Boolean(setting.requiresReload),
      filePicker: setting.filePicker ?? null,
      control,
      choices: choices ? Object.fromEntries(Object.entries(choices).map(([k, v]) => [k, label(v)])) : null,
      range,
      value
    });
  }
  return entries;
}

/**
 * Flat search across every category. Matches label and hint, because a
 * setting whose name you cannot remember is exactly the one you search for.
 * @param {Array<object>} categories
 * @param {string} query
 * @returns {Array<{category: string, entry: object}>}
 */
export function searchSettings(categories, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return [];
  const hits = [];
  for (const category of categories) {
    for (const entry of category.entries) {
      const haystack = `${entry.label} ${entry.hint ?? ""}`.toLowerCase();
      if (haystack.includes(needle)) hits.push({ category: category.label, entry });
    }
  }
  return hits;
}
