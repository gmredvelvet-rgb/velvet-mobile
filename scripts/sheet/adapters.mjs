/**
 * Velvet Mobile — system adapters for the mobile sheet.
 *
 * Each adapter turns an Actor into a system-agnostic view model the
 * MobileSheet renders. Supported systems get the full native mobile sheet;
 * anything else returns null and the shell falls back to pinning the
 * system's own sheet fullscreen.
 *
 * View model shape:
 *   {
 *     subtitle: string,
 *     hp: { value, max, temp, pct } | null,
 *     ac: number|string|null,
 *     stats: [{ label, value, onTap? }],
 *     applyHp: (delta) => Promise,
 *     tabs: [{
 *       id, icon, label,
 *       sections: [{
 *         title?, badge?,
 *         type?: "abilities",              // grid of ability cells
 *         abilities?: [{ key, label, mod, onTap, onLong }],
 *         rows?: [{
 *           id, img?, icon?, label, sub?, badge?, prof?,
 *           onTap?,                        // roll / use
 *           actions?: [{ icon, label, onTap }],
 *           description?: () => Promise<string>
 *         }]
 *       }]
 *     }]
 *   }
 *
 * @module sheet/adapters
 */

import { L10N } from "../core/constants.mjs";
import { Logger } from "../core/logger.mjs";

/** @param {string} key @returns {string} */
const t = (key) => game.i18n.localize(`${L10N}.Sheet.${key}`);

/** Signed modifier string. @param {number} n @returns {string} */
const signed = (n) => `${n >= 0 ? "+" : ""}${n ?? 0}`;

/** CONFIG label entries are strings in old systems, objects in new ones. */
const labelOf = (entry, fallback) => {
  if (!entry) return fallback;
  const raw = typeof entry === "string" ? entry : entry.label;
  return raw ? game.i18n.localize(raw) : fallback;
};

/** Clamp-update the universal HP path — works on dnd5e and pf2e alike. */
const makeApplyHp = (actor) => async (delta) => {
  const hp = actor.system?.attributes?.hp;
  if (!hp) return;
  const value = Math.max(0, Math.min(hp.max ?? 0, (hp.value ?? 0) + delta));
  await actor.update({ "system.attributes.hp.value": value });
};

/** @param {Actor} actor @returns {object|null} HP block. */
const hpOf = (actor) => {
  const hp = actor.system?.attributes?.hp;
  if (!hp || !Number.isFinite(hp.max) || hp.max <= 0) return null;
  return {
    value: hp.value ?? 0,
    max: hp.max,
    temp: hp.temp ?? 0,
    pct: Math.max(0, Math.min(100, Math.round(((hp.value ?? 0) / hp.max) * 100)))
  };
};

/** Lazy enriched description for an item row. @param {Item} item */
const describe = (item) => async () => {
  const source = item.system?.description?.value ?? "";
  if (!source) return "";
  try {
    const enricher = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    return await enricher.enrichHTML(source, { relativeTo: item, rollData: item.getRollData?.() ?? {}, secrets: false });
  } catch {
    return source;
  }
};

/** Wrap a roll callback so one broken roll never kills the sheet. */
const safe = (fn) => async (...args) => {
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
 */
const attempt = (label, fn, fallback) => {
  try {
    return fn();
  } catch (err) {
    Logger.error(`Mobile sheet: "${label}" section failed`, err);
    return fallback;
  }
};

/* ------------------------------------------------------------------------- *
 * D&D 5e
 * ------------------------------------------------------------------------- */

/** dnd5e changed roll signatures in v4: try the modern form, fall back. */
const dnd5eRoll = (actor, modern, legacy) => safe(async () => {
  try {
    return await modern();
  } catch (err) {
    if (legacy) return legacy();
    throw err;
  }
});

/** @param {Actor} actor @returns {object} */
function dnd5eModel(actor) {
  const system = actor.system;
  const C = CONFIG.DND5E ?? {};

  const classes = (actor.itemTypes?.class ?? [])
    .map((c) => `${c.name} ${c.system?.levels ?? ""}`.trim());
  const race = actor.itemTypes?.race?.[0]?.name;
  const subtitle = [classes.join(" / "), race].filter(Boolean).join(" · ");

  /* Abilities */
  const abilities = attempt("abilities", () => Object.entries(system.abilities ?? {}).map(([key, abl]) => ({
    key,
    label: labelOf(C.abilities?.[key], key).slice(0, 3).toUpperCase(),
    mod: signed(abl.mod ?? 0),
    onTap: dnd5eRoll(actor,
      () => actor.rollAbilityCheck({ ability: key }),
      () => actor.rollAbilityTest?.(key)),
    onLong: dnd5eRoll(actor,
      () => actor.rollSavingThrow({ ability: key }),
      () => actor.rollAbilitySave?.(key))
  })), []);

  /* Skills */
  const skills = attempt("skills", () => Object.entries(system.skills ?? {})
    .map(([key, skl]) => ({
      id: key,
      label: labelOf(C.skills?.[key], key),
      sub: (skl.ability ?? "").toUpperCase(),
      badge: signed(skl.total ?? skl.mod ?? 0),
      prof: (skl.value ?? 0) > 0,
      onTap: dnd5eRoll(actor,
        () => actor.rollSkill({ skill: key }),
        () => actor.rollSkill?.(key))
    }))
    .sort((a, b) => a.label.localeCompare(b.label)), []);

  /* Combat: equipped weapons first, then the rest */
  const weapons = attempt("weapons", () => (actor.itemTypes?.weapon ?? [])
    .sort((a, b) => (b.system?.equipped === true) - (a.system?.equipped === true))
    .map((item) => ({
      id: item.id,
      img: item.img,
      label: item.name,
      sub: [item.labels?.toHit, item.labels?.damage].filter(Boolean).join(" · "),
      badge: item.system?.equipped ? "✓" : "",
      onTap: safe(() => item.use()),
      description: describe(item)
    })), []);

  /* Inventory */
  const inventoryTypes = new Set(["weapon", "equipment", "consumable", "tool", "container", "backpack", "loot"]);
  const inventory = attempt("inventory", () => (actor.items?.contents ?? [])
    .filter((i) => inventoryTypes.has(i.type))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => {
      const equippable = typeof item.system?.equipped === "boolean";
      const qty = item.system?.quantity;
      let badge = "";
      if (qty > 1) badge = `×${qty}`;
      else if (equippable && item.system.equipped) badge = "✓";
      return {
        id: item.id,
        img: item.img,
        label: item.name,
        sub: item.system?.type?.label ?? item.type,
        badge,
        onTap: safe(() => item.use()),
        actions: equippable ? [{
          icon: "fa-solid fa-shield-halved",
          label: t("Equip"),
          onTap: safe(() => item.update({ "system.equipped": !item.system.equipped }))
        }] : [],
        description: describe(item)
      };
    }), []);

  /* Spells grouped by level, with slots */
  const spellSections = attempt("spells", () => {
    const spells = actor.itemTypes?.spell ?? [];
    if (!spells.length) return [];
    const byLevel = new Map();
    for (const spell of spells) {
      const level = spell.system?.level ?? 0;
      if (!byLevel.has(level)) byLevel.set(level, []);
      byLevel.get(level).push(spell);
    }
    const sections = [];
    for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
      const slot = level > 0 ? system.spells?.[`spell${level}`] : null;
      sections.push({
        title: labelOf(C.spellLevels?.[level], level === 0 ? t("Cantrips") : `${t("Level")} ${level}`),
        badge: slot?.max > 0 ? `${slot.value}/${slot.max}` : "",
        rows: byLevel.get(level)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((spell) => ({
            id: spell.id,
            img: spell.img,
            label: spell.name,
            sub: spell.labels?.activation ?? "",
            onTap: safe(() => spell.use()),
            description: describe(spell)
          }))
      });
    }
    return sections;
  }, []);

  /* Features */
  const features = attempt("features", () => (actor.itemTypes?.feat ?? []).map((item) => ({
    id: item.id,
    img: item.img,
    label: item.name,
    sub: item.system?.type?.label ?? "",
    onTap: safe(() => (item.displayCard ? item.displayCard() : item.use())),
    description: describe(item)
  })), []);

  const tabs = [
    {
      id: "stats",
      icon: "fa-solid fa-user",
      label: t("TabStats"),
      sections: [
        { type: "abilities", abilities },
        { title: t("Skills"), rows: skills }
      ]
    },
    {
      id: "combat",
      icon: "fa-solid fa-hand-fist",
      label: t("TabCombat"),
      sections: [{ title: t("Attacks"), rows: weapons }]
    },
    {
      id: "inventory",
      icon: "fa-solid fa-sack",
      label: t("TabInventory"),
      sections: [{ title: t("TabInventory"), rows: inventory }]
    }
  ];
  if (spellSections.length) {
    tabs.push({ id: "spells", icon: "fa-solid fa-wand-sparkles", label: t("TabSpells"), sections: spellSections });
  }
  tabs.push({
    id: "features",
    icon: "fa-solid fa-sparkles",
    label: t("TabFeatures"),
    sections: [{ title: t("TabFeatures"), rows: features }]
  });

  return {
    subtitle,
    hp: hpOf(actor),
    ac: system.attributes?.ac?.value ?? null,
    applyHp: makeApplyHp(actor),
    stats: [
      { label: t("Initiative"), value: signed(system.attributes?.init?.total ?? 0),
        onTap: dnd5eRoll(actor, () => actor.rollInitiativeDialog(), () => actor.rollInitiative()) },
      { label: t("Speed"), value: `${system.attributes?.movement?.walk ?? 0}` },
      { label: t("Proficiency"), value: signed(system.attributes?.prof ?? 0) }
    ],
    tabs
  };
}

/* ------------------------------------------------------------------------- *
 * Pathfinder 2e
 * ------------------------------------------------------------------------- */

/** @param {Actor} actor @returns {object} */
function pf2eModel(actor) {
  const system = actor.system;
  const details = system.details ?? {};
  const subtitle = attempt("subtitle", () => {
    const className = actor.class?.name ?? details.class?.name;
    const level = details.level?.value ? `${t("Level")} ${details.level.value}` : "";
    return [className, level].filter(Boolean).join(" · ");
  }, "");

  /* Abilities: checks are made through skills in PF2e; cells just display. */
  const abilities = attempt("abilities", () => Object.entries(system.abilities ?? {}).map(([key, abl]) => ({
    key,
    label: key.toUpperCase(),
    mod: signed(abl.mod ?? 0)
  })), []);

  /* Saves + Perception as quick rollable rows */
  const saves = attempt("saves", () => {
    const rows = Object.values(actor.saves ?? {}).filter(Boolean).map((statistic) => ({
      id: statistic.slug ?? statistic.label,
      label: statistic.label ?? statistic.slug ?? "?",
      badge: signed(statistic.mod ?? 0),
      prof: (statistic.rank ?? 0) > 0,
      onTap: safe(() => statistic.roll({}))
    }));
    if (actor.perception?.roll) {
      rows.unshift({
        id: "perception",
        label: actor.perception.label ?? t("Perception"),
        badge: signed(actor.perception.mod ?? 0),
        prof: (actor.perception.rank ?? 0) > 0,
        onTap: safe(() => actor.perception.roll({}))
      });
    }
    return rows;
  }, []);

  /* Skills */
  const skills = attempt("skills", () => Object.values(actor.skills ?? {})
    .filter((s) => s && typeof s.roll === "function")
    .map((statistic) => ({
      id: statistic.slug ?? statistic.label,
      label: statistic.label ?? statistic.slug ?? "?",
      badge: signed(statistic.mod ?? 0),
      prof: (statistic.rank ?? 0) > 0,
      onTap: safe(() => statistic.roll({}))
    }))
    .sort((a, b) => a.label.localeCompare(b.label)), []);

  /* Strikes */
  const strikes = attempt("strikes", () => (system.actions ?? [])
    .filter((a) => a?.type === "strike" && a.visible !== false)
    .map((strike, index) => ({
      id: `strike-${index}`,
      img: strike.imageUrl ?? strike.item?.img,
      label: strike.label ?? strike.slug ?? "?",
      sub: signed(strike.totalModifier ?? 0),
      onTap: safe(() => (strike.variants?.[0]?.roll ?? strike.roll)?.({})),
      actions: typeof strike.damage === "function" ? [{
        icon: "fa-solid fa-burst",
        label: t("Damage"),
        onTap: safe(() => strike.damage({}))
      }] : []
    })), []);

  /* Inventory */
  const inventoryTypes = new Set(["weapon", "armor", "equipment", "consumable", "treasure", "backpack", "shield"]);
  const inventory = attempt("inventory", () => (actor.items?.contents ?? [])
    .filter((i) => inventoryTypes.has(i.type))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({
      id: item.id,
      img: item.img,
      label: item.name,
      sub: item.type,
      badge: item.system?.quantity > 1 ? `×${item.system.quantity}` : "",
      onTap: safe(() => item.toMessage?.() ?? item.toChat?.()),
      description: describe(item)
    })), []);

  /* Spells + feats: post to chat */
  const spells = attempt("spells", () => (actor.itemTypes?.spell ?? []).map((item) => ({
    id: item.id,
    img: item.img,
    label: item.name,
    sub: `${t("Level")} ${item.system?.level?.value ?? 0}`,
    onTap: safe(() => item.toMessage?.() ?? item.toChat?.()),
    description: describe(item)
  })), []);
  const features = attempt("features", () => (actor.itemTypes?.feat ?? []).map((item) => ({
    id: item.id,
    img: item.img,
    label: item.name,
    onTap: safe(() => item.toMessage?.() ?? item.toChat?.()),
    description: describe(item)
  })), []);

  const tabs = [
    {
      id: "stats",
      icon: "fa-solid fa-user",
      label: t("TabStats"),
      sections: [
        { type: "abilities", abilities },
        { title: t("Saves"), rows: saves },
        { title: t("Skills"), rows: skills }
      ]
    },
    {
      id: "combat",
      icon: "fa-solid fa-hand-fist",
      label: t("TabCombat"),
      sections: [{ title: t("Attacks"), rows: strikes }]
    },
    {
      id: "inventory",
      icon: "fa-solid fa-sack",
      label: t("TabInventory"),
      sections: [{ title: t("TabInventory"), rows: inventory }]
    }
  ];
  if (spells.length) {
    tabs.push({ id: "spells", icon: "fa-solid fa-wand-sparkles", label: t("TabSpells"), sections: [{ title: t("TabSpells"), rows: spells }] });
  }
  tabs.push({ id: "features", icon: "fa-solid fa-sparkles", label: t("TabFeatures"), sections: [{ title: t("TabFeatures"), rows: features }] });

  return {
    subtitle,
    hp: hpOf(actor),
    ac: attempt("ac", () => system.attributes?.ac?.value ?? null, null),
    applyHp: makeApplyHp(actor),
    stats: attempt("stats", () => [
      { label: t("Initiative"),
        value: signed(actor.initiative?.mod ?? actor.initiative?.statistic?.mod ?? actor.perception?.mod ?? 0),
        onTap: typeof actor.initiative?.roll === "function" ? safe(() => actor.initiative.roll({})) : undefined },
      { label: t("Speed"), value: `${system.attributes?.speed?.total ?? system.attributes?.speed?.value ?? 0}` }
    ], []),
    tabs
  };
}

/* ------------------------------------------------------------------------- */

const SUPPORTED_TYPES = new Set(["character", "npc"]);

/**
 * Build the mobile view model for an actor, or null when the system or
 * actor type is not supported (the shell then pins the native sheet).
 * @param {Actor} actor
 * @returns {object|null}
 */
export function modelFor(actor) {
  if (!actor || !SUPPORTED_TYPES.has(actor.type)) return null;
  try {
    let model;
    switch (game.system.id) {
      case "dnd5e": model = dnd5eModel(actor); break;
      case "pf2e": model = pf2eModel(actor); break;
      default: return null;
    }
    // A model with nothing to show is worse than the system's own sheet:
    // reject it so the shell pins the native one instead.
    if (!model?.tabs?.length) {
      Logger.warn(`Mobile sheet model for "${actor.name}" has no content — using the native sheet`);
      return null;
    }
    return model;
  } catch (err) {
    Logger.error("Mobile sheet model failed — falling back to the native sheet", err);
    return null;
  }
}
