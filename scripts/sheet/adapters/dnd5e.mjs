/**
 * Velvet Mobile — D&D 5e adapter.
 *
 * Behaviour is unchanged from the single-file adapter it was extracted from;
 * only the helper imports moved.
 *
 * @module sheet/adapters/dnd5e
 */

import { attempt, describe, hpOf, labelOf, makeApplyHp, safe, signed, t } from "./shared.mjs";

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
        onTap: roll5e(() => actor.rollInitiativeDialog(), () => actor.rollInitiative()) },
      { label: t("Speed"), value: `${system.attributes?.movement?.walk ?? 0}` },
      { label: t("Proficiency"), value: signed(system.attributes?.prof ?? 0) }
    ],
    tabs
  };
}
