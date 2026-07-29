/**
 * Velvet Mobile — D&D 5e adapter.
 *
 * Behaviour is unchanged from the single-file adapter it was extracted from;
 * only the helper imports moved.
 *
 * @module sheet/adapters/dnd5e
 */

import {
  attempt, conditionsOf, conditionsSection, describe, formatDuration, hpOf, itemMenu, labelOf,
  makeApplyHp, makeApplyTempHp, num, restRows, restSection, safe, signed, t, text
} from "./shared.mjs";

/** Actor types this adapter renders. */
export const types = ["character", "npc"];

/** dnd5e changed roll signatures in v4: try the modern form, fall back. */
const roll5e = (modern, legacy) => safe(async () => {
  try {
    return await modern();
  } catch (err) {
    if (legacy) return legacy();
    throw err;
  }
});

/** Preparation states, with the system's own numbers as the fallback. */
const PREP_STATE = () => CONFIG.DND5E?.spellPreparationStates ?? {};
const prepValue = (name, fallback) => PREP_STATE()[name]?.value ?? fallback;

/**
 * Whether a casting method involves preparing spells at all.
 *
 * Read from the system's own config rather than hard-coded: `spell` is the
 * obvious one, but **pact magic prepares too**, and a warlock whose spells
 * had no toggle would be stuck. Innate and at-will magic do not.
 *
 * @param {string} method
 * @returns {boolean}
 */
const methodPrepares = (method) => {
  const config = CONFIG.DND5E?.spellcasting?.[method];
  // No config at all (an unknown or module-added method): assume the classic
  // prepared caster, which is what the legacy data model called "prepared".
  if (!config) return method === "spell" || method === "prepared";
  return config.prepares === true;
};

/**
 * How a spell's preparation is stored, and how to flip it.
 *
 * dnd5e 5.1 replaced `system.preparation.{mode,prepared}` with
 * `system.method` and a numeric `system.prepared` (0 no, 1 yes, 2 always),
 * and made the old path a deprecation-warning getter that is removed in 5.4.
 * So the modern shape is detected first and the legacy one is only touched
 * on data that has no `method` — reading `preparation` on a modern spell
 * logs a warning for every spell on the sheet.
 *
 * Returns null when preparation does not apply: cantrips, at-will and innate
 * magic, and always-prepared spells have nothing to toggle.
 *
 * @param {Item} spell
 * @returns {{prepared: boolean, toggle: () => Promise<*>}|null}
 */
function preparation(spell) {
  const system = spell?.system ?? {};
  // Cantrips are always available; there is nothing to prepare.
  const level = Number(system.level ?? 0);
  if (level <= 0) return null;

  if (system.method !== undefined) {
    if (!methodPrepares(system.method)) return null;
    // "Always prepared" is granted by a feature, not the player's to change.
    if (Number(system.prepared) === prepValue("always", 2)) return null;
    const on = prepValue("prepared", 1);
    const prepared = Number(system.prepared) === on;
    return {
      prepared,
      toggle: () => spell.update({ "system.prepared": prepared ? prepValue("unprepared", 0) : on })
    };
  }

  const legacy = system.preparation;
  if (legacy?.mode !== "prepared") return null;
  const prepared = Boolean(legacy.prepared);
  return { prepared, toggle: () => spell.update({ "system.preparation.prepared": !prepared }) };
}

/* -- Effects --------------------------------------------------------------- */

/**
 * How much longer an effect lasts.
 *
 * Core computes a label for both kinds of duration, but for a time-based one
 * it is literally "3600 Seconds" — correct, and useless for an hour-long
 * spell — so seconds are reformatted. Turn-based durations keep core's label,
 * which already says "3 Rounds" and knows about the combat's turn order.
 *
 * @param {ActiveEffect} effect
 * @returns {string}
 */
function effectDuration(effect) {
  const duration = effect?.duration ?? {};
  if (duration.type === "seconds") {
    const remaining = num(duration.remaining);
    if (remaining !== null) return formatDuration(remaining);
  }
  // Turn-based with no combat running has no label at all — core returns a
  // bare `{type: "turns"}` — so this is legitimately empty sometimes.
  return text(duration.label);
}

/**
 * The effects currently running on a creature.
 *
 * Only the temporary ones. A 5e character carries a passive effect for
 * practically every feature they own, and a phone list of forty "+1 to
 * something" entries is noise; what a player needs mid-session is the
 * handful of things with a clock on them. `isTemporary` is dnd5e's own
 * getter, so concealed effects are already excluded.
 *
 * Effects carrying a status are skipped: those are conditions, and the chips
 * directly above already show them. Listing them twice would be worse than
 * the rare buff that also applies a status being shown only as a chip.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function effectRows(actor) {
  const all = typeof actor.allApplicableEffects === "function"
    ? [...actor.allApplicableEffects()]
    : [...(actor.effects ?? [])];

  return all
    .filter((effect) => effect?.isTemporary && (effect.statuses?.size ?? 0) === 0)
    .map((effect) => {
      // Suppression comes from the parent item being unequipped or
      // unattuned, so it cannot be toggled off here — only the item can.
      const suppressed = effect.isSuppressed === true;
      const editable = actor.isOwner && !suppressed;
      const disabled = effect.disabled === true;

      const actions = [];
      if (editable) {
        actions.push({
          icon: disabled ? "fa-regular fa-circle" : "fa-solid fa-circle-check",
          label: disabled ? t("Enable") : t("Disable"),
          active: !disabled,
          onTap: safe(() => effect.update({ disabled: !disabled }))
        });
      }
      if (actor.isOwner) {
        actions.push({
          icon: "fa-solid fa-xmark",
          label: t("RemoveEffect"),
          onTap: safe(() => effect.delete())
        });
      }

      let state = "";
      if (suppressed) state = t("Suppressed");
      else if (disabled) state = t("Disabled");

      return {
        id: effect.id,
        img: effect.img ?? effect.icon,
        label: effect.name,
        sub: [effectDuration(effect), state].filter(Boolean).join(" · "),
        // Inactive for any reason: still listed so it can be turned back on,
        // but it is not doing anything and should not read as if it were.
        dim: disabled || suppressed,
        actions,
        description: describeEffect(effect)
      };
    });
}

/** Lazy enriched description for an effect. @param {ActiveEffect} effect */
const describeEffect = (effect) => async () => {
  const source = text(effect.description, effect.system?.description);
  if (!source) return "";
  try {
    const enricher = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    return await enricher.enrichHTML(source, { relativeTo: effect, secrets: false });
  } catch {
    return source;
  }
};

/**
 * "Prepared 5 / 7" per spellcasting class.
 *
 * A prepared caster's real constraint is not slots but how many spells they
 * committed to this morning, and that number lives on the class item rather
 * than the actor. Without it the spell list shows what you *know* with no
 * indication of how much of your daily allowance is spent.
 *
 * @param {Actor} actor
 * @returns {object[]} Rows, empty for casters that do not prepare.
 */
function preparationRows(actor) {
  const classes = actor.spellcastingClasses ?? {};
  const rows = [];
  for (const [identifier, cls] of Object.entries(classes)) {
    const prep = cls?.system?.spellcasting?.preparation;
    const max = Number(prep?.max ?? 0);
    // A spontaneous caster has no preparation allowance; a zero max means
    // the concept does not apply rather than "you may prepare none".
    if (!max) continue;
    const value = Number(prep?.value ?? 0);
    rows.push({
      id: `prep-${identifier}`,
      img: cls.img,
      label: cls.name,
      sub: t("Prepared"),
      badge: `${value} / ${max}`,
      // Over the allowance is a real state the sheet should not hide.
      dim: value > max
    });
  }
  return rows;
}

/** @param {Actor} actor @returns {object} */
export function model(actor) {
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
    onTap: roll5e(
      () => actor.rollAbilityCheck({ ability: key }),
      () => actor.rollAbilityTest?.(key)),
    onLong: roll5e(
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
      onTap: roll5e(
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
      menu: itemMenu(actor, item),
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
        menu: itemMenu(actor, item),
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
    // The daily allowance, above the list it constrains.
    const prepared = attempt("preparation", () => preparationRows(actor), []);
    if (prepared.length) sections.push({ title: t("Preparation"), rows: prepared });
    for (const level of [...byLevel.keys()].sort((a, b) => a - b)) {
      const slot = level > 0 ? system.spells?.[`spell${level}`] : null;
      sections.push({
        title: labelOf(C.spellLevels?.[level], level === 0 ? t("Cantrips") : `${t("Level")} ${level}`),
        badge: slot?.max > 0 ? `${slot.value}/${slot.max}` : "",
        rows: byLevel.get(level)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((spell) => {
            const prep = preparation(spell);
            return {
              id: spell.id,
              img: spell.img,
              // An unprepared spell is not castable today; saying so on the
              // row saves opening the menu to find out.
              sub: [spell.labels?.activation, prep && !prep.prepared ? t("Unprepared") : ""]
                .filter(Boolean).join(" · "),
              label: spell.name,
              // Dim what you know but did not prepare, so the list reads as
              // "today's spells" at a glance instead of "every spell I own".
              dim: Boolean(prep) && !prep.prepared,
              onTap: safe(() => spell.use()),
              // A first-class button, not just a long-press entry: choosing
              // the day's spells means toggling a dozen of them in a row, and
              // a long press each time is the wrong tool for that.
              actions: prep ? [{
                icon: prep.prepared ? "fa-solid fa-bookmark" : "fa-regular fa-bookmark",
                label: prep.prepared ? t("Unprepare") : t("Prepare"),
                active: prep.prepared,
                onTap: safe(() => prep.toggle())
              }] : [],
              menu: itemMenu(actor, spell, [prep ? {
                id: "prepare",
                icon: "fa-solid fa-book-bookmark",
                label: prep.prepared ? t("Unprepare") : t("Prepare"),
                onTap: safe(() => prep.toggle())
              } : null]),
              description: describe(spell)
            };
          })
      });
    }
    return sections;
  }, []);

  /* Conditions — core status effects; dnd5e registers its own list into
     CONFIG.statusEffects, so the shared helper already offers the right set. */
  const conditions = attempt("conditions", () => conditionsOf(actor), []);
  const effects = attempt("effects", () => effectRows(actor), []);

  /* Rests. Both open the system's own dialog, so hit dice and the rest of
     the bookkeeping stay dnd5e's business rather than ours. */
  const rests = attempt("rests", () => restRows([
    {
      id: "short-rest",
      label: t("ShortRest"),
      icon: "icons/svg/regen.svg",
      available: typeof actor.shortRest === "function",
      onTap: safe(() => actor.shortRest())
    },
    {
      id: "long-rest",
      label: t("LongRest"),
      icon: "icons/svg/sleep.svg",
      available: typeof actor.longRest === "function",
      onTap: safe(() => actor.longRest())
    }
  ]), []);

  /* Features */
  const features = attempt("features", () => (actor.itemTypes?.feat ?? []).map((item) => ({
    id: item.id,
    img: item.img,
    label: item.name,
    sub: item.system?.type?.label ?? "",
    onTap: safe(() => (item.displayCard ? item.displayCard() : item.use())),
    menu: itemMenu(actor, item),
    description: describe(item)
  })), []);

  const tabs = [
    {
      id: "stats",
      icon: "fa-solid fa-user",
      label: t("TabStats"),
      sections: [
        { type: "abilities", abilities },
        ...restSection(rests),
        { title: t("Skills"), rows: skills }
      ]
    },
    {
      id: "combat",
      icon: "fa-solid fa-hand-fist",
      label: t("TabCombat"),
      sections: [
        ...conditionsSection(conditions),
        ...(effects.length ? [{ title: t("Effects"), badge: String(effects.length), rows: effects }] : []),
        { title: t("Attacks"), rows: weapons }
      ]
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
    applyTempHp: makeApplyTempHp(actor),
    stats: [
      { label: t("Initiative"), value: signed(system.attributes?.init?.total ?? 0),
        onTap: roll5e(() => actor.rollInitiativeDialog(), () => actor.rollInitiative()) },
      { label: t("Speed"), value: `${system.attributes?.movement?.walk ?? 0}` },
      { label: t("Proficiency"), value: signed(system.attributes?.prof ?? 0) }
    ],
    tabs
  };
}
