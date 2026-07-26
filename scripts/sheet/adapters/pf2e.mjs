/**
 * Velvet Mobile — Pathfinder 2e adapter.
 *
 * PF2e exposes almost everything through derived `Statistic` objects on the
 * actor (`actor.skills`, `actor.saves`, `actor.perception`, `actor.system
 * .actions`) rather than through raw system data, so this adapter prefers
 * those and only falls back to `system.*` for old data models. Every lookup
 * is defensive: PF2e reshapes its API between major versions and a phone is
 * the worst place to discover a thrown error.
 *
 * @module sheet/adapters/pf2e
 */

import {
  at, attempt, describe, hpOf, itemTypeLabel, maybeLocalize, makeApplyHp,
  num, safe, signed, t, text, titleCase
} from "./shared.mjs";
import { Logger } from "../../core/logger.mjs";

/** Actor types this adapter renders. Familiars have no strikes but do have HP. */
export const types = ["character", "npc", "familiar"];

/** Coin denominations, richest first — PF2e's canonical order. */
const CURRENCY = Object.freeze([["pp", "Platinum"], ["gp", "Gold"], ["sp", "Silver"], ["cp", "Copper"]]);

/** Item types that belong in the inventory tab. */
const INVENTORY_TYPES = new Set(["weapon", "armor", "shield", "equipment", "consumable", "treasure", "backpack"]);

/** Item types that belong in the features tab. */
const FEATURE_TYPES = new Set(["feat", "action", "ancestry", "heritage", "background", "class", "deity", "lore"]);

/**
 * PF2e reads roll modifiers off the originating DOM event (shift skips or
 * shows the dialog, depending on the user's own preference). We have no real
 * event, so synthesise one that honours that preference.
 * @param {object} [dataset]
 * @returns {object}
 */
function rollEvent(dataset = {}) {
  const target = document.createElement("button");
  for (const [key, value] of Object.entries(dataset)) {
    if (value !== null && value !== undefined && value !== "") target.dataset[key] = String(value);
  }
  const settings = game.user?.settings ?? {};
  const showDialog = String(dataset.dialogType ?? "check") === "damage"
    ? settings.showDamageDialogs === true
    : settings.showCheckDialogs === true;
  return {
    target,
    currentTarget: target,
    shiftKey: showDialog,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {}
  };
}

/** Roll a PF2e `Statistic`, whichever shape it takes. @param {object} statistic */
const rollStatistic = (statistic) => safe(() => {
  const args = { event: rollEvent(), skipDialog: true };
  if (typeof statistic?.roll === "function") return statistic.roll(args);
  if (typeof statistic?.check?.roll === "function") return statistic.check.roll(args);
  throw new Error(t("NotRollable"));
});

/** A rollable row for a PF2e statistic (skill, save, perception). */
const statisticRow = (statistic, id) => ({
  id: text(statistic?.slug, id, statistic?.label),
  label: maybeLocalize(statistic?.label, titleCase(text(statistic?.slug, id))),
  sub: titleCase(text(statistic?.attribute, statistic?.ability)),
  badge: signed(num(statistic?.mod, statistic?.check?.mod, statistic?.totalModifier) ?? 0),
  prof: (num(statistic?.rank, statistic?.proficiency?.rank) ?? 0) > 0,
  onTap: rollStatistic(statistic)
});

/** Traits as a `Set`, an array or a plain object — always come back as strings. */
const traitsOf = (item) => {
  const raw = item?.system?.traits?.value ?? item?.traits;
  if (raw instanceof Set) return [...raw].map(String);
  if (Array.isArray(raw)) return raw.map(String);
  if (raw && typeof raw === "object") return Object.values(raw).map(String);
  return [];
};

/**
 * Normalised action cost, or null when the item is passive.
 * @param {Item} item
 * @returns {{type:string, value:number}|null}
 */
function actionCost(item) {
  const direct = item?.actionCost;
  if (direct && typeof direct === "object") {
    const type = String(direct.type ?? "action").toLowerCase();
    return { type, value: type === "free" ? 0 : (num(direct.value) ?? 1) };
  }
  if (item?.type === "spell") {
    const time = text(item?.actionGlyph, item?.system?.time?.value).toLowerCase();
    if (/^[1-3]$/.test(time)) return { type: "action", value: Number(time) };
    if (["r", "reaction"].includes(time)) return { type: "reaction", value: 1 };
    if (["f", "free"].includes(time)) return { type: "free", value: 0 };
    return null;
  }
  const type = text(item?.system?.actionType?.value, item?.system?.actionType).toLowerCase();
  if (!type || type === "passive") return null;
  return { type, value: type === "free" ? 0 : (num(item?.system?.actions?.value, item?.system?.actions) ?? 1) };
}

/** Short badge for an action cost — "1", "2", "3", "R", "F". */
function costBadge(item) {
  const cost = actionCost(item);
  if (!cost) return "";
  if (cost.type === "reaction") return t("Reaction");
  if (cost.type === "free") return t("FreeAction");
  return "◆".repeat(Math.max(1, Math.min(3, cost.value || 1)));
}

/** Whether this spell can be cast right now (slots, focus, cantrip…). */
const spellRank = (spell) => num(spell?.rank, spell?.system?.level?.value, spell?.system?.level) ?? 0;
const isCantrip = (spell) => spell?.isCantrip === true || traitsOf(spell).includes("cantrip");
const isFocus = (spell) => spell?.isFocusSpell === true || traitsOf(spell).includes("focus");
const isRitual = (spell) => spell?.isRitual === true || traitsOf(spell).includes("ritual");

/** The spellcasting entry a spell belongs to. @returns {Item|null} */
function entryFor(actor, spell) {
  if (spell?.spellcasting) return spell.spellcasting;
  const id = text(spell?.system?.location?.value);
  return actor?.spellcasting?.get?.(id) ?? actor?.items?.get?.(id) ?? null;
}

/** Cast a spell through its entry, degrading to a chat card. */
const castSpell = (actor, spell) => safe(async () => {
  const entry = entryFor(actor, spell);
  const rank = spellRank(spell);
  if (typeof entry?.cast === "function") {
    try {
      return await entry.cast(spell, { rank });
    } catch (err) {
      Logger.debug("Spellcasting entry refused the cast — posting the card instead", err);
    }
  }
  if (typeof spell.toMessage === "function") return spell.toMessage();
  throw new Error(t("NotRollable"));
});

/** Use an item: consumables are consumed, system actions run, rest go to chat. */
const usePf2eItem = (actor, item) => safe(async () => {
  if (item.type === "consumable" && typeof item.consume === "function") return item.consume();
  const slug = text(item?.slug, item?.system?.slug);
  const action = slug ? (game.pf2e?.actions?.get?.(slug) ?? game.pf2e?.actions?.[slug]) : null;
  if (typeof action === "function") return action({ actors: [actor] });
  if (typeof action?.use === "function") return action.use({ actors: [actor] });
  if (typeof item.toMessage === "function") return item.toMessage();
  if (typeof item.use === "function") return item.use();
  throw new Error(t("NotRollable"));
});

/* -- Carry state ----------------------------------------------------------- */

/** @param {Item} item @returns {{carryType:string, handsHeld:number, inSlot:boolean}} */
function carryState(item) {
  const equipped = item?.system?.equipped ?? {};
  return {
    carryType: text(equipped.carryType) || "worn",
    handsHeld: num(equipped.handsHeld) ?? 0,
    inSlot: equipped.inSlot === true
  };
}

/** Short display for the carry button. */
function carryLabel(item) {
  const { carryType, handsHeld, inSlot } = carryState(item);
  if (carryType === "held") return handsHeld === 2 ? t("CarryHeld2") : t("CarryHeld1");
  if (carryType === "worn") return inSlot ? t("CarryWorn") : t("CarryCarried");
  if (carryType === "stowed") return t("CarryStowed");
  if (carryType === "dropped") return t("CarryDropped");
  return titleCase(carryType);
}

/**
 * PF2e does not have a boolean "equipped": an item is held in one or two
 * hands, worn in a slot, carried, stowed or dropped. Ask, rather than guess.
 * @param {Actor} actor
 * @param {Item} item
 */
const promptCarry = (actor, item) => safe(async () => {
  if (typeof actor.changeCarryType !== "function") throw new Error(t("NotRollable"));
  const usage = item.system?.usage ?? {};
  const current = carryState(item);
  const choices = [
    { action: "held1", label: t("CarryHeld1"), carryType: "held", handsHeld: 1, inSlot: false },
    { action: "held2", label: t("CarryHeld2"), carryType: "held", handsHeld: 2, inSlot: false }
  ];
  if (usage.where) {
    choices.push({ action: "worn", label: t("CarryWorn"), carryType: "worn", handsHeld: 0, inSlot: true });
  }
  choices.push({ action: "carried", label: t("CarryCarried"), carryType: "worn", handsHeld: 0, inSlot: false });
  choices.push({ action: "stowed", label: t("CarryStowed"), carryType: "stowed", handsHeld: 0, inSlot: false });

  const isCurrent = (choice) => choice.carryType === current.carryType
    && (choice.carryType !== "held" || choice.handsHeld === current.handsHeld)
    && (choice.carryType !== "worn" || choice.inSlot === current.inSlot);

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: item.name },
    position: { width: 320 },
    content: `<p style="margin: 0 0 .5rem;">${foundry.utils.escapeHTML(t("CarryHint"))}</p>`,
    buttons: choices.map((choice) => ({
      action: choice.action,
      label: choice.label,
      default: isCurrent(choice),
      callback: () => choice
    })),
    rejectClose: false
  });
  if (!picked) return;
  await actor.changeCarryType(item, {
    carryType: picked.carryType,
    handsHeld: picked.handsHeld,
    inSlot: picked.inSlot
  });
});

/* -- Ammunition ------------------------------------------------------------ */

/**
 * Ammunition a weapon can actually be loaded with, built the same way PF2e's
 * own reloader builds it: loose ammo the character is carrying, plus weapons
 * usable as ammunition (shuriken, darts…).
 *
 * `strike.ammunition.compatible` carries only ids and labels — and is empty
 * on some data shapes — so the real items are resolved off the actor.
 * @param {Actor} actor
 * @param {Item} weapon
 * @returns {Item[]}
 */
function compatibleAmmo(actor, weapon) {
  const loose = (actor.itemTypes?.ammo ?? []).filter((item) => !item.isStowed);
  const asAmmo = (actor.itemTypes?.weapon ?? []).filter((item) => item.system?.usage?.canBeAmmo);
  return [...loose, ...asAmmo].filter((item) => item !== weapon && item.isAmmoFor?.(weapon) === true);
}

/**
 * What is loaded and how much is left, for the strike's sub line — the
 * "Empty" the desktop sheet shows next to its Reload button.
 * @param {Actor} actor
 * @param {object} ammunition  A strike's `ammunition` view model.
 * @returns {string}
 */
function ammoLabel(actor, ammunition) {
  const loaded = ammunition.loaded ?? [];
  if (loaded.length) {
    const rounds = loaded.reduce((sum, ammo) => sum + (num(ammo.quantity) ?? 0), 0);
    const capacity = num(ammunition.capacity) ?? 0;
    return `${text(loaded[0]?.name)} ${capacity > 1 ? `${rounds}/${capacity}` : rounds}`.trim();
  }
  // Weapons without a reload time point at a stack rather than holding it.
  const linked = ammunition.selected?.id ? actor.items?.get(ammunition.selected.id) : null;
  if (linked) return `${linked.name} ×${num(linked.quantity) ?? 0}`;
  return t("AmmoEmpty");
}

/**
 * Load — or link — ammunition for a strike.
 *
 * PF2e's own reload control is an anchored popover that refuses to render
 * without a desktop sheet element to attach to, so a phone had no way to
 * reach it: a weapon with a reload time simply could not be fired, because
 * the system rejects the strike outright when nothing is loaded.
 *
 * Weapons with a reload time carry their ammunition as subitems and are
 * loaded with `attach()`; weapons that merely expend ammunition (bows,
 * slings) just point at a stack through `system.selectedAmmoId`.
 * @param {Actor} actor
 * @param {Item} weapon
 * @param {object} ammunition
 */
const promptReload = (actor, weapon, ammunition) => safe(async () => {
  const options = compatibleAmmo(actor, weapon);
  if (!options.length) throw new Error(t("AmmoNone"));

  const load = async (ammo) => {
    if (!ammunition.requiresReload) {
      return weapon.update({ system: { selectedAmmoId: ammo.id } });
    }
    // Free space is read off the weapon rather than the captured view model:
    // a second tap before the sheet refreshes would otherwise reload against
    // a stale count and overfill the magazine.
    const capacity = num(weapon.system?.ammo?.capacity) ?? 1;
    const loaded = [...(weapon.subitems ?? [])].filter((item) =>
      item.isOfType?.("ammo") || (item.isOfType?.("weapon") && item.isAmmoFor?.(weapon) === true));
    const free = capacity - loaded.reduce((sum, item) => sum + (num(item.quantity) ?? 0), 0);
    if (free <= 0) return undefined;
    // Fill the magazine in one tap rather than one round per tap: the
    // desktop's per-round control is far too much tapping on a phone.
    return weapon.attach(ammo, { quantity: Math.min(free, num(ammo.quantity) ?? 1), stack: true });
  };

  if (options.length === 1) return load(options[0]);

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: weapon.name },
    position: { width: 320 },
    content: `<p style="margin: 0 0 .5rem;">${foundry.utils.escapeHTML(t("AmmoHint"))}</p>`,
    buttons: options.slice(0, 6).map((ammo, i) => ({
      action: `ammo${i}`,
      label: `${ammo.name} (${num(ammo.quantity) ?? 0})`,
      default: i === 0,
      callback: () => ammo
    })),
    rejectClose: false
  });
  if (picked) await load(picked);
});

/* -- Strikes --------------------------------------------------------------- */

/**
 * Build one strike row: tap attacks at full modifier, the trailing buttons
 * roll damage and a critical, and a long press picks a MAP variant. Strikes
 * that consume ammunition also get a reload button and their ammo state.
 */
function strikeRow(actor, strike, index) {
  const variants = Array.isArray(strike?.variants) ? strike.variants : [];
  const traits = traitsOf(strike?.item).filter((trait) => !["common", "uncommon", "rare", "unique"].includes(trait));
  const actions = [];

  if (typeof strike?.damage === "function") {
    actions.push({
      icon: "fa-solid fa-burst",
      label: t("Damage"),
      onTap: safe(() => strike.damage({ event: rollEvent({ dialogType: "damage" }) }))
    });
  }
  if (typeof strike?.critical === "function") {
    actions.push({
      icon: "fa-solid fa-explosion",
      label: t("Critical"),
      onTap: safe(() => strike.critical({ event: rollEvent({ dialogType: "damage" }) }))
    });
  }

  /* Ammunition. Reloading comes first: an empty weapon cannot be fired at
     all, so it is the action the player needs before any of the others. */
  const ammunition = strike?.ammunition;
  const weapon = strike?.item;
  let ammoSub = "";
  if (ammunition && weapon) {
    ammoSub = ammoLabel(actor, ammunition);
    // A full magazine has nothing to reload — the desktop hides the control
    // in exactly the same case.
    const full = ammunition.requiresReload && !((num(ammunition.remaining) ?? 0) > 0);
    if (!full) {
      actions.unshift({
        icon: "fa-solid fa-rotate-right",
        label: t("Reload"),
        onTap: promptReload(actor, weapon, ammunition)
      });
    }
  }

  const attack = (variantIndex) => safe(() => {
    const variant = variants[variantIndex] ?? variants[0];
    if (typeof variant?.roll === "function") return variant.roll({ event: rollEvent(), skipDialog: true });
    if (typeof strike?.roll === "function") return strike.roll({ event: rollEvent(), skipDialog: true });
    throw new Error(t("NotRollable"));
  });

  /* Multiple Attack Penalty picker — the second and third attacks of a turn. */
  const onLong = variants.length > 1
    ? safe(async () => {
      const picked = await foundry.applications.api.DialogV2.wait({
        window: { title: text(strike?.label, strike?.slug) },
        position: { width: 320 },
        content: `<p style="margin: 0 0 .5rem;">${foundry.utils.escapeHTML(t("MapHint"))}</p>`,
        buttons: variants.slice(0, 3).map((variant, i) => ({
          action: `map${i}`,
          label: text(variant?.label) || signed(num(variant?.modifier) ?? 0),
          default: i === 0,
          callback: () => i
        })),
        rejectClose: false
      });
      if (typeof picked === "number") await attack(picked)();
    })
    : undefined;

  return {
    id: text(strike?.item?.id, `strike-${index}`),
    img: text(strike?.imageUrl, strike?.item?.img) || "icons/svg/sword.svg",
    label: text(strike?.label, strike?.slug) || t("Attacks"),
    sub: [
      signed(num(strike?.totalModifier, variants[0]?.modifier) ?? 0),
      ammoSub,
      traits.slice(0, 2).map(titleCase).join(" · ")
    ].filter(Boolean).join(" · "),
    badge: strike?.ready === false ? t("NotReady") : "",
    onTap: attack(0),
    onLong,
    actions,
    description: strike?.item ? describe(strike.item) : undefined
  };
}

/* -- Spell slots ----------------------------------------------------------- */

/**
 * Total available/maximum slots per rank across every spellcasting entry, so
 * the section header can say "2/4" the way the desktop sheet does.
 * @param {Actor} actor
 * @returns {Map<number, {value:number, max:number}>}
 */
function slotTotals(actor) {
  const totals = new Map();
  const entries = actor?.spellcasting?.contents ?? actor?.spellcasting ?? [];
  for (const entry of entries) {
    if (!entry?.system?.slots || entry.isFocusPool || entry.isRitual) continue;
    for (let rank = 1; rank <= 10; rank += 1) {
      const slot = entry.system.slots[`slot${rank}`];
      if (!slot) continue;
      const value = num(slot.value) ?? 0;
      const max = num(slot.max) ?? value;
      if (value <= 0 && max <= 0) continue;
      const current = totals.get(rank) ?? { value: 0, max: 0 };
      current.value += value;
      current.max += max;
      totals.set(rank, current);
    }
  }
  return totals;
}

/* -- Model ----------------------------------------------------------------- */

/** @param {Actor} actor @returns {object} */
export function model(actor) {
  const system = actor.system ?? {};
  const details = system.details ?? {};

  const subtitle = attempt("subtitle", () => {
    const level = num(actor.level, details.level?.value, details.level);
    const parts = actor.type === "character"
      ? [
        text(actor.ancestry?.name, details.ancestry?.name),
        text(actor.class?.name, details.class?.name)
      ]
      : [titleCase(text(details.creatureType, details.publication?.title))];
    if (level !== null) parts.push(`${t("Level")} ${level}`);
    return parts.filter(Boolean).join(" · ");
  }, "");

  /* Abilities: PF2e rolls checks through skills, so the cells only display. */
  const abilities = attempt("abilities", () => Object.entries(actor.abilities ?? system.abilities ?? {})
    .map(([key, abl]) => ({
      key,
      label: (maybeLocalize(CONFIG.PF2E?.abilities?.[key], key) || key).slice(0, 3).toUpperCase(),
      mod: signed(num(abl?.mod) ?? 0)
    })), []);

  /* Perception + saves as quick rollable rows. */
  const saves = attempt("saves", () => {
    const rows = Object.entries(actor.saves ?? {})
      .filter(([, statistic]) => Boolean(statistic))
      .map(([key, statistic]) => statisticRow(statistic, key));
    if (actor.perception) rows.unshift(statisticRow(actor.perception, "perception"));
    return rows;
  }, []);

  const skills = attempt("skills", () => Object.entries(actor.skills ?? {})
    .filter(([, statistic]) => statistic && (typeof statistic.roll === "function" || typeof statistic.check?.roll === "function"))
    .map(([key, statistic]) => statisticRow(statistic, key))
    .sort((a, b) => a.label.localeCompare(b.label)), []);

  /* Hero points, focus and the dying track — the resources a player actually
     touches mid-session, with tap-to-spend and long-press-to-regain. */
  const resources = attempt("resources", () => {
    const rows = [];
    const step = (path, current, max, label, id) => ({
      id,
      label,
      badge: `${current} / ${max}`,
      onTap: max > 0 ? safe(() => actor.update({ [path]: Math.max(0, current - 1) })) : undefined,
      onLong: max > 0 ? safe(() => actor.update({ [path]: Math.min(max, current + 1) })) : undefined,
      sub: t("TapSpend")
    });

    const hero = actor.heroPoints ?? system.resources?.heroPoints;
    if (hero && (num(hero.max) ?? 0) > 0) {
      rows.push(step("system.resources.heroPoints.value", num(hero.value) ?? 0, num(hero.max) ?? 3, t("HeroPoints"), "hero"));
    }
    const focus = system.resources?.focus;
    if (focus && (num(focus.max) ?? 0) > 0) {
      rows.push(step("system.resources.focus.value", num(focus.value) ?? 0, num(focus.max) ?? 0, t("FocusPoints"), "focus"));
    }
    const dying = at(actor, "attributes.dying") ?? system.attributes?.dying;
    if (dying && (num(dying.value) ?? 0) > 0) {
      rows.push({
        id: "dying",
        label: t("Dying"),
        badge: `${num(dying.value) ?? 0} / ${num(dying.max) ?? 4}`,
        sub: `${t("Recovery")} ${(num(dying.recoveryDC) ?? 10) + (num(dying.value) ?? 0)}`,
        onTap: typeof actor.rollRecovery === "function"
          ? safe(() => actor.rollRecovery(rollEvent()))
          : undefined
      });
    }
    return rows;
  }, []);

  /* Strikes. Familiars and some NPCs have none — the section just stays empty. */
  const strikes = attempt("strikes", () => (Array.isArray(system.actions) ? system.actions : [])
    .filter((a) => a && a.type === "strike" && a.visible !== false)
    .map((strike, index) => strikeRow(actor, strike, index)), []);

  /* Activatable feats and actions, grouped with the strikes. */
  const activities = attempt("activities", () => (actor.items?.contents ?? [])
    .filter((item) => ["action", "feat"].includes(item.type) && actionCost(item))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({
      id: item.id,
      img: item.img,
      label: item.name,
      sub: traitsOf(item).filter((trait) => !["common", "uncommon", "rare", "unique"].includes(trait))
        .slice(0, 3).map(titleCase).join(" · "),
      badge: costBadge(item),
      onTap: usePf2eItem(actor, item),
      description: describe(item)
    })), []);

  /* Inventory, with PF2e's carry states rather than a boolean equipped flag. */
  const inventory = attempt("inventory", () => (actor.items?.contents ?? [])
    .filter((item) => INVENTORY_TYPES.has(item.type) && item.isCoinage !== true)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => {
      const quantity = num(item.system?.quantity);
      const invested = item.system?.equipped?.invested;
      const badges = [
        quantity !== null && quantity !== 1 ? `×${quantity}` : "",
        invested === true ? t("Invested") : ""
      ].filter(Boolean);
      return {
        id: item.id,
        img: item.img,
        label: item.name,
        sub: [carryLabel(item), maybeLocalize(CONFIG.PF2E?.Item?.typeLabels?.[item.type], itemTypeLabel(item.type))]
          .filter(Boolean).join(" · "),
        badge: badges.join(" "),
        onTap: usePf2eItem(actor, item),
        onLong: promptCarry(actor, item),
        actions: typeof actor.changeCarryType === "function" ? [{
          icon: "fa-solid fa-hand",
          label: t("Carry"),
          onTap: promptCarry(actor, item)
        }] : [],
        description: describe(item)
      };
    }), []);

  const currency = attempt("currency", () => {
    const coins = actor.inventory?.currency;
    if (!coins) return [];
    return CURRENCY
      .map(([key, label]) => ({ id: key, label: t(label), badge: String(num(coins[key]) ?? 0) }))
      .filter((row) => row.badge !== "0");
  }, []);

  /* Spells grouped by rank, with cantrips, focus and rituals split out. */
  const spellSections = attempt("spells", () => {
    const spells = actor.itemTypes?.spell ?? [];
    if (!spells.length) return [];
    const totals = slotTotals(actor);
    const focusPool = system.resources?.focus;

    const buckets = { cantrips: [], focus: [], rituals: [], byRank: new Map() };
    for (const spell of spells) {
      if (isCantrip(spell)) buckets.cantrips.push(spell);
      else if (isFocus(spell)) buckets.focus.push(spell);
      else if (isRitual(spell)) buckets.rituals.push(spell);
      else {
        const rank = spellRank(spell);
        if (!buckets.byRank.has(rank)) buckets.byRank.set(rank, []);
        buckets.byRank.get(rank).push(spell);
      }
    }

    const rowsOf = (list) => list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((spell) => ({
        id: spell.id,
        img: spell.img,
        label: spell.name,
        // The action cost is already the badge; the sub line is for traits.
        sub: traitsOf(spell)
          .filter((trait) => !["common", "uncommon", "rare", "unique", "cantrip", "focus"].includes(trait))
          .slice(0, 3).map(titleCase).join(" · "),
        badge: costBadge(spell),
        onTap: castSpell(actor, spell),
        description: describe(spell)
      }));

    const sections = [];
    if (buckets.cantrips.length) sections.push({ title: t("Cantrips"), rows: rowsOf(buckets.cantrips) });
    for (const rank of [...buckets.byRank.keys()].sort((a, b) => a - b)) {
      const slot = totals.get(rank);
      sections.push({
        title: `${t("Rank")} ${rank}`,
        badge: slot && slot.max > 0 ? `${slot.value}/${slot.max}` : "",
        rows: rowsOf(buckets.byRank.get(rank))
      });
    }
    if (buckets.focus.length) {
      sections.push({
        title: t("FocusSpells"),
        badge: (num(focusPool?.max) ?? 0) > 0 ? `${num(focusPool?.value) ?? 0}/${num(focusPool?.max) ?? 0}` : "",
        rows: rowsOf(buckets.focus)
      });
    }
    if (buckets.rituals.length) sections.push({ title: t("Rituals"), rows: rowsOf(buckets.rituals) });
    return sections;
  }, []);

  const features = attempt("features", () => (actor.items?.contents ?? [])
    .filter((item) => FEATURE_TYPES.has(item.type) && !actionCost(item))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({
      id: item.id,
      img: item.img,
      label: item.name,
      sub: maybeLocalize(CONFIG.PF2E?.Item?.typeLabels?.[item.type], itemTypeLabel(item.type)),
      onTap: safe(() => item.toMessage?.()),
      description: describe(item)
    })), []);

  /* Header chips. */
  const stats = attempt("stats", () => {
    const chips = [];
    const initiative = actor.initiative;
    const initMod = num(initiative?.mod, initiative?.statistic?.mod, actor.perception?.mod);
    chips.push({
      label: t("Initiative"),
      value: signed(initMod ?? 0),
      onTap: typeof initiative?.roll === "function"
        ? safe(() => initiative.roll({ event: rollEvent(), skipDialog: true }))
        : undefined
    });

    /* Every movement type the creature has, not just its walk speed. */
    const speeds = system.movement?.speeds ?? {};
    const walk = num(speeds.land?.value, speeds.land, system.attributes?.speed?.total, system.attributes?.speed?.value);
    chips.push({ label: t("Speed"), value: `${walk ?? 0}` });

    const classDc = num(
      actor.getStatistic?.("class")?.dc?.value,
      system.attributes?.classDC?.value,
      system.attributes?.classOrSpellDC?.value
    );
    if (classDc !== null) chips.push({ label: t("ClassDC"), value: String(classDc) });

    const perception = num(actor.perception?.mod, system.attributes?.perception?.value);
    if (perception !== null) {
      chips.push({
        label: t("Perception"),
        value: signed(perception),
        onTap: actor.perception ? rollStatistic(actor.perception) : undefined
      });
    }
    return chips;
  }, []);

  /* Tabs — only the ones with something behind them. A familiar with no
     skills must not get a tab bar full of empty lists. */
  const tabs = [];
  if (abilities.length || resources.length || saves.length || skills.length) {
    tabs.push({
      id: "stats",
      icon: "fa-solid fa-user",
      label: t("TabStats"),
      sections: [
        ...(abilities.length ? [{ type: "abilities", abilities }] : []),
        ...(resources.length ? [{ title: t("Resources"), rows: resources }] : []),
        ...(saves.length ? [{ title: t("Saves"), rows: saves }] : []),
        ...(skills.length ? [{ title: t("Skills"), rows: skills }] : [])
      ]
    });
  }

  if (strikes.length || activities.length) {
    tabs.push({
      id: "combat",
      icon: "fa-solid fa-hand-fist",
      label: t("TabCombat"),
      sections: [
        { title: t("Strikes"), rows: strikes },
        ...(activities.length ? [{ title: t("TabActions"), rows: activities }] : [])
      ]
    });
  }

  if (inventory.length || currency.length) {
    tabs.push({
      id: "inventory",
      icon: "fa-solid fa-sack",
      label: t("TabInventory"),
      sections: [
        ...(currency.length ? [{ title: t("Currency"), rows: currency }] : []),
        { title: t("TabInventory"), rows: inventory }
      ]
    });
  }

  if (spellSections.length) {
    tabs.push({ id: "spells", icon: "fa-solid fa-wand-sparkles", label: t("TabSpells"), sections: spellSections });
  }

  if (features.length) {
    tabs.push({
      id: "features",
      icon: "fa-solid fa-sparkles",
      label: t("TabFeatures"),
      sections: [{ title: t("TabFeatures"), rows: features }]
    });
  }

  return {
    subtitle,
    hp: hpOf(actor),
    ac: attempt("ac", () => num(at(actor, "attributes.ac.value"), system.attributes?.ac?.value), null),
    applyHp: makeApplyHp(actor),
    stats,
    tabs
  };
}
