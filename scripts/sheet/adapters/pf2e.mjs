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
  at, attempt, conditionsOf, conditionsSection, describe, effectsTab, hpOf, itemMenu, itemTypeLabel,
  formatDuration, maybeLocalize, makeApplyHp, makeApplyTempHp, num, restRows, restSection, safe, signed,
  sortConditions, t, text, titleCase
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
 * Whether to skip the roll dialog, computed the way PF2e computes it.
 *
 * PF2e's own rule is `skipDialog = !game.user.settings.showCheckDialogs`,
 * with Shift *inverting* it. We must derive it rather than force it: a player
 * who has turned roll dialogs on wants them on the phone too, and forcing
 * `skipDialog: true` is what made every tap fire straight into chat.
 *
 * @param {"check"|"damage"} [kind]
 * @returns {boolean}
 */
function skipDialogFor(kind = "check") {
  const settings = game.user?.settings ?? {};
  const wants = kind === "damage" ? settings.showDamageDialogs : settings.showCheckDialogs;
  return wants !== true;
}

/**
 * PF2e reads roll modifiers off the originating DOM event. We have no real
 * one, so synthesise a stand-in carrying the dataset some rolls read.
 *
 * `shiftKey` is deliberately false. PF2e treats Shift as *inverting* the
 * user's dialog preference, so setting it to "the user wants dialogs" turned
 * the preference upside down for exactly the people who had asked for them.
 * A tap is not a Shift-click; the preference itself travels in `skipDialog`.
 *
 * Note also that `Statistic#roll` only derives parameters from an event that
 * is a real `PointerEvent`, which this is not — so this object contributes
 * its dataset and nothing else, and `skipDialog` has to be passed explicitly.
 *
 * @param {object} [dataset]
 * @returns {object}
 */
function rollEvent(dataset = {}) {
  const target = document.createElement("button");
  for (const [key, value] of Object.entries(dataset)) {
    if (value !== null && value !== undefined && value !== "") target.dataset[key] = String(value);
  }
  return {
    target,
    currentTarget: target,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {}
  };
}

/** Roll a PF2e `Statistic`, whichever shape it takes. @param {object} statistic */
const rollStatistic = (statistic) => safe(() => {
  const args = { event: rollEvent(), skipDialog: skipDialogFor("check") };
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

/**
 * An action cost as the character the system's own action font draws.
 *
 * PF2e ships `Pathfinder2eActions`, where "1"/"2"/"3" are the action pips,
 * "R" is the reaction arrow and "F" the free-action diamond — plus the
 * variable forms like "1/2". Emitting those characters and setting that font
 * gives the real iconography rather than a Unicode lookalike, and it matches
 * what the player sees on the desktop sheet and in chat.
 *
 * Read from the item when the system computes it, because that keeps the
 * mapping in the system's hands: variable-cost activities ("1 or 2") and
 * anything a future release adds come through correctly without us tracking
 * the table. The fallback covers items that expose a cost but no glyph.
 *
 * @param {Item} item
 * @returns {string} A glyph character, or "" when the item has no cost.
 */
function costGlyph(item) {
  const own = text(item?.actionGlyph).trim();
  if (own) return own;
  const cost = actionCost(item);
  if (!cost) return "";
  if (cost.type === "reaction") return "R";
  if (cost.type === "free") return "F";
  return String(Math.max(1, Math.min(3, cost.value || 1)));
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

/* -- Roll-option toggles --------------------------------------------------- */

/**
 * One toggle row: the checkbox (or dropdown) PF2e draws above its strikes.
 * @param {Actor} actor
 * @param {object} toggle  An entry of `actor.synthetics.toggles[domain]`.
 * @returns {object}
 */
function toggleRow(actor, toggle) {
  const label = maybeLocalize(toggle.label, text(toggle.label, toggle.option));
  const suboptions = (toggle.suboptions ?? []).map((sub) => ({
    value: sub.value,
    label: maybeLocalize(sub.label, text(sub.label, sub.value)),
    selected: sub.selected === true
  }));
  const selected = suboptions.find((sub) => sub.selected) ?? suboptions[0] ?? null;
  const alwaysActive = toggle.alwaysActive === true;
  const checked = toggle.checked === true || alwaysActive;

  const set = (value, suboption) => safe(() =>
    actor.toggleRollOption(toggle.domain, toggle.option, toggle.itemId ?? null, value, suboption ?? null));

  // A single suboption is fixed — the desktop disables its dropdown too.
  const pick = suboptions.length > 1
    ? safe(async () => {
      const picked = await foundry.applications.api.DialogV2.wait({
        window: { title: label },
        position: { width: 320 },
        content: `<p style="margin: 0 0 .5rem;">${foundry.utils.escapeHTML(t("ToggleHint"))}</p>`,
        buttons: suboptions.slice(0, 8).map((sub, i) => ({
          action: `opt${i}`,
          label: sub.label,
          default: sub.selected,
          callback: () => sub.value
        })),
        rejectClose: false
      });
      if (picked) await set(checked, picked)();
    })
    : undefined;

  /* An always-active toggle is a dropdown with no checkbox, so tapping it
     picks the option; everything else flips, with the option one tap aside. */
  let onTap;
  if (alwaysActive) onTap = pick;
  else if (toggle.enabled !== false || checked) onTap = set(!checked, selected?.value);

  return {
    id: `${toggle.domain}:${toggle.option}`,
    label,
    sub: suboptions.length ? (selected?.label ?? "") : "",
    badge: !alwaysActive && checked ? "✓" : "",
    prof: alwaysActive ? undefined : checked,
    onTap,
    onLong: alwaysActive ? undefined : pick,
    actions: pick ? [{ icon: "fa-solid fa-list-ul", label: t("ToggleOption"), onTap: pick }] : []
  };
}

/**
 * The options PF2e's own Actions tab shows above the strikes — Current Form,
 * Double Slice, Hunt Prey, One Shot One Kill…
 *
 * They are `RollOption` rule elements, which the system collects into
 * `actor.synthetics.toggles` as `{ domain: { option: toggle } }`, and writes
 * back through `actor.toggleRollOption()`. Only the ones placed in the
 * actions area are ours; the rest belong next to a specific statistic.
 * @param {Actor} actor
 * @returns {object[]}
 */
function toggleRows(actor) {
  const domains = actor.synthetics?.toggles ?? {};
  return Object.values(domains)
    .flatMap((domain) => Object.values(domain ?? {}))
    .filter((toggle) => toggle && (toggle.placement ?? "actions") === "actions")
    .map((toggle) => toggleRow(actor, toggle));
}

/* -- Encounter / exploration / downtime ------------------------------------ */

/**
 * Which of the three panels PF2e's Actions tab would file this item under,
 * or null when it belongs to none of them.
 *
 * Mirrors the system's own pass (`#prepareAbilities`): every `action` item
 * qualifies whatever it costs, feats only when they cost an action, and the
 * `exploration` / `downtime` traits pull an item out of the encounter list.
 * @param {Item} item
 * @returns {"encounter"|"exploration"|"downtime"|null}
 */
function actionPanel(item) {
  const qualifies = item?.type === "action" || (item?.type === "feat" && Boolean(actionCost(item)));
  if (!qualifies || item.suppressed === true) return null;
  const traits = traitsOf(item);
  if (traits.includes("exploration")) return "exploration";
  if (traits.includes("downtime")) return "downtime";
  return "encounter";
}

/** Traits worth showing on a row — rarity is noise on a phone. */
const displayTraits = (item) => traitsOf(item)
  .filter((trait) => !["common", "uncommon", "rare", "unique"].includes(trait))
  .slice(0, 3).map(titleCase).join(" · ");

/**
 * The exploration activities currently running.
 *
 * `system.exploration` is a plain list of item ids on the actor. The desktop
 * sheet's `toggle-exploration` handler drops ids whose item is gone before
 * writing, and so do we — a stale id would otherwise survive forever. An
 * actor whose data model predates the field, or a module that has replaced
 * it with something else, gets an empty list rather than a thrown section.
 * @param {Actor} actor
 * @returns {string[]}
 */
function explorationIds(actor) {
  const raw = actor.system?.exploration;
  if (!Array.isArray(raw)) return [];
  return raw.filter((id) => actor.items?.has(id));
}

/**
 * Start or stop an exploration activity.
 * @param {Actor} actor
 * @param {Item} item
 */
const toggleExploration = (actor, item) => safe(async () => {
  const current = explorationIds(actor);
  const next = current.includes(item.id)
    ? current.filter((id) => id !== item.id)
    : [...current, item.id];
  await actor.update({ "system.exploration": next });
});

/**
 * Exploration activities — Avoid Notice, Search, Follow the Expert…
 *
 * A tap starts or stops the activity the way the desktop's toggle does; the
 * chat button posts the card, which is what a tap does everywhere else, so
 * neither gesture is lost. Active ones sort to the top, mirroring the
 * "Active" group the desktop sheet splits out.
 * @param {Actor} actor
 * @param {Item[]} items
 * @returns {object[]}
 */
function explorationRows(actor, items) {
  const active = new Set(explorationIds(actor));
  return items
    .map((item) => ({ item, on: active.has(item.id) }))
    .sort((a, b) => (Number(b.on) - Number(a.on)) || a.item.name.localeCompare(b.item.name))
    .map(({ item, on }) => ({
      id: item.id,
      img: item.img,
      label: item.name,
      sub: [on ? t("ExplorationActive") : "", displayTraits(item)].filter(Boolean).join(" · "),
      badge: on ? "✓" : "",
      onTap: toggleExploration(actor, item),
      actions: [{
        icon: "fa-solid fa-comment",
        label: t("SendToChat"),
        onTap: usePf2eItem(actor, item)
      }],
      description: describe(item)
    }));
}

/* -- Conditions ------------------------------------------------------------ */

/**
 * PF2e conditions are Items, not core ActiveEffects, and many of them carry
 * a value — frightened 2, clumsy 1, dying 3. Core's `toggleStatusEffect`
 * only knows on/off, so the chips route through PF2e's own condition API
 * instead and expose a stepper for the valued ones.
 *
 * Persistent damage is excluded: it needs a damage type and formula, which is
 * a dialog rather than a toggle, and PF2e leaves it out of its own list too.
 *
 * @param {Actor} actor
 * @returns {object[]} Chips, or the generic ones if PF2e's API is missing.
 */
function pf2eConditions(actor) {
  const catalogue = game.pf2e?.ConditionManager?.conditions;
  if (!actor?.isOwner || !catalogue || typeof actor.toggleCondition !== "function") {
    return conditionsOf(actor);
  }

  /* Applied conditions, by slug. PF2e stores each as an owned item, so the
     value we want to show lives on the item rather than in the catalogue. */
  const applied = new Map();
  for (const condition of actor.conditions?.active ?? []) {
    if (condition?.slug) applied.set(condition.slug, condition);
  }

  const chips = [];
  for (const [slug, condition] of catalogue.entries()) {
    if (slug === "persistent-damage") continue;
    const on = applied.get(slug);
    const valued = condition?.system?.value?.isValued === true;
    const chip = {
      id: slug,
      // The catalogue name first, deliberately: an applied PF2e condition
      // folds its value into its name ("Frightened 2"), which would read
      // twice next to the value badge.
      label: text(condition?.name, on?.name) || titleCase(slug),
      img: text(condition?.img, on?.img),
      active: Boolean(on),
      value: valued ? num(on?.value) : null,
      onTap: safe(() => actor.toggleCondition(slug))
    };
    if (on && valued) {
      chip.onIncrease = safe(() => actor.increaseCondition(slug));
      // `forceRemove: false` steps down to zero and then off, which is what a
      // player tapping "−" on a frightened 1 expects.
      chip.onDecrease = safe(() => actor.decreaseCondition(slug, { forceRemove: false }));
    }
    chips.push(chip);
  }
  return sortConditions(chips);
}

/* -- Effects --------------------------------------------------------------- */

/**
 * How much longer an effect lasts.
 *
 * Counted in the unit the effect was written in, not the largest that
 * divides evenly: ten rounds of Bless is "10 rds" to a player counting
 * turns, and calling it "1 min" is technically true and useless. Only when
 * the declared unit has run down below one — half an hour left on an
 * hour-long buff — does it drop to the next unit down.
 *
 * Falls back to the declared duration when PF2e cannot compute a remaining
 * time (no start recorded, an unsupported unit).
 *
 * @param {Item} effect
 * @returns {string}
 */
function durationLabel(effect) {
  const duration = effect?.system?.duration ?? {};
  const unit = text(duration.unit);
  if (unit === "unlimited") return t("DurationUnlimited");
  if (unit === "encounter") return t("DurationEncounter");

  const remaining = num(effect?.remainingDuration?.remaining);
  if (remaining === null || !Number.isFinite(remaining)) {
    const value = num(duration.value);
    return value === null || !unit ? "" : `${value} ${titleCase(unit)}`;
  }
  return formatDuration(remaining, { from: unit });
}

/**
 * The effects currently on a creature — spell durations, buffs, afflictions —
 * with the controls PF2e's own effects panel offers.
 *
 * Separate from conditions on purpose: a condition is a rules state you turn
 * on and off, an effect is something running with a clock on it, and the
 * thing you need to see about an effect is how much longer it lasts.
 *
 * @param {Actor} actor
 * @returns {object[]}
 */
function effectRows(actor) {
  const effects = actor.itemTypes?.effect ?? [];
  return effects.map((effect) => {
    const badge = effect.badge ?? effect.system?.badge ?? null;
    const counter = badge?.type === "counter";
    const editable = actor.isOwner && effect.isOwner !== false;

    const actions = [];
    if (editable && counter && typeof effect.decrease === "function") {
      actions.push({
        icon: "fa-solid fa-minus",
        label: t("Decrease"),
        onTap: safe(() => effect.decrease())
      });
    }
    if (editable && counter && typeof effect.increase === "function") {
      actions.push({
        icon: "fa-solid fa-plus",
        label: t("Increase"),
        onTap: safe(() => effect.increase())
      });
    }
    if (editable) {
      // Ending an effect is not deleting a possession — it is how effects
      // finish, and PF2e's own panel removes them on a click too. It gets a
      // visible button rather than hiding in the long-press menu.
      actions.push({
        icon: "fa-solid fa-xmark",
        label: t("RemoveEffect"),
        onTap: safe(() => effect.delete())
      });
    }

    return {
      id: effect.id,
      img: effect.img,
      label: effect.name,
      sub: [durationLabel(effect), effect.fromAura ? t("FromAura") : ""].filter(Boolean).join(" · "),
      badge: text(counter ? String(num(badge?.value) ?? "") : badge?.label),
      // An expired effect is still listed — PF2e leaves it for you to dismiss
      // — but it is no longer doing anything, so it should not read as live.
      dim: effect.isExpired === true,
      actions,
      menu: itemMenu(actor, effect),
      description: describe(effect)
    };
  });
}

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
      onTap: safe(() => strike.damage({ event: rollEvent({ dialogType: "damage" }), skipDialog: skipDialogFor("damage") }))
    });
  }
  if (typeof strike?.critical === "function") {
    actions.push({
      icon: "fa-solid fa-explosion",
      label: t("Critical"),
      onTap: safe(() => strike.critical({ event: rollEvent({ dialogType: "damage" }), skipDialog: skipDialogFor("damage") }))
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
    const args = { event: rollEvent(), skipDialog: skipDialogFor("check") };
    if (typeof variant?.roll === "function") return variant.roll(args);
    if (typeof strike?.roll === "function") return strike.roll(args);
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

  /* Combat options — the checkboxes the desktop draws above its strikes. */
  const toggles = attempt("toggles", () => toggleRows(actor), []);
  const conditions = attempt("conditions", () => pf2eConditions(actor), []);
  const effects = attempt("effects", () => effectRows(actor), []);

  /* Rests. Neither Pathfinder 2e nor Starfinder 2e has a short rest: Rest for
     the Night is the only one. Take a Breather is deliberately not offered —
     it belongs to the optional Stamina variant, which is off by default, and
     `game.pf2e.actions` lists it whether or not the variant is enabled, so
     its presence in the registry says nothing about whether it applies. */
  const rests = attempt("rests", () => {
    const action = (slug) => game.pf2e?.actions?.get?.(slug) ?? game.pf2e?.actions?.[slug];
    const run = (slug) => safe(async () => {
      const entry = action(slug);
      if (typeof entry === "function") return entry({ actors: [actor] });
      if (typeof entry?.use === "function") return entry.use({ actors: [actor] });
      throw new Error(t("NotRollable"));
    });
    return restRows([
      {
        id: "rest-for-the-night",
        label: t("RestForTheNight"),
        icon: "icons/svg/sleep.svg",
        available: Boolean(action("restForTheNight")),
        onTap: run("restForTheNight")
      }
    ]);
  }, []);

  /* The three panels the desktop splits its Actions tab into, bucketed in a
     single pass so no item can ever land in two of them. */
  const panels = attempt("actions", () => {
    const buckets = { encounter: [], exploration: [], downtime: [] };
    for (const item of actor.items?.contents ?? []) {
      const panel = actionPanel(item);
      // Encounter keeps its long-standing rule — only things that cost an
      // action — so passive abilities stay where they have always been, in
      // the Features tab. Exploration and downtime follow the desktop and
      // take everything, since most of those activities cost nothing.
      if (!panel || (panel === "encounter" && !actionCost(item))) continue;
      buckets[panel].push(item);
    }
    return buckets;
  }, { encounter: [], exploration: [], downtime: [] });

  /** Rows for items whose tap simply uses them. @param {Item[]} items */
  const useRows = (items) => [...items]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((item) => ({
      id: item.id,
      img: item.img,
      label: item.name,
      sub: displayTraits(item),
      cost: costGlyph(item),
      onTap: usePf2eItem(actor, item),
      menu: itemMenu(actor, item),
      description: describe(item)
    }));

  /* Activatable feats and actions, grouped with the strikes. */
  const activities = attempt("activities", () => useRows(panels.encounter), []);
  const exploration = attempt("exploration", () => explorationRows(actor, panels.exploration), []);
  const downtime = attempt("downtime", () => useRows(panels.downtime), []);

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
        actions: typeof actor.changeCarryType === "function" ? [{
          icon: "fa-solid fa-hand",
          label: t("Carry"),
          onTap: promptCarry(actor, item)
        }] : [],
        menu: itemMenu(actor, item, [typeof actor.changeCarryType === "function" ? {
          id: "carry",
          icon: "fa-solid fa-hand",
          label: t("Carry"),
          onTap: promptCarry(actor, item)
        } : null]),
        description: describe(item)
      };
    }), []);

  const currency = attempt("currency", () => {
    const coins = actor.inventory?.currency;
    if (!coins) return [];
    const values = CURRENCY
      .map(([key, label]) => `${t(label)} ${String(num(coins[key]) ?? 0)}`)
      .filter(Boolean);
    return values.length ? [{
      id: "currency",
      label: values.join(" · "),
      badge: "",
      sub: "",
      onTap: null
    }] : [];
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
        // The action cost has its own field; the sub line is for traits.
        sub: traitsOf(spell)
          .filter((trait) => !["common", "uncommon", "rare", "unique", "cantrip", "focus"].includes(trait))
          .slice(0, 3).map(titleCase).join(" · "),
        cost: costGlyph(spell),
        onTap: castSpell(actor, spell),
        menu: itemMenu(actor, spell),
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
    // Exploration and downtime activities have their own sections now, and
    // most of them are costless — without this they would show up twice.
    .filter((item) => FEATURE_TYPES.has(item.type) && !actionCost(item)
      && !["exploration", "downtime"].includes(actionPanel(item)))
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
        ? safe(() => initiative.roll({ event: rollEvent(), skipDialog: skipDialogFor("check") }))
        : undefined
    });

    /* Every movement type the creature has, not just its walk speed. */
    const speeds = system.movement?.speeds ?? {};
    // `num()` evaluates every argument, so a single call would touch the
    // deprecated `system.attributes.speed` getter on every build even when
    // the modern path already answered. PF2e deprecated it in 7.5.0 and
    // removes it in 8.0.0.
    const walk = num(speeds.land?.value, speeds.land)
      ?? num(system.attributes?.speed?.total, system.attributes?.speed?.value);
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
  if (abilities.length || resources.length || saves.length || skills.length || rests.length) {
    tabs.push({
      id: "stats",
      icon: "fa-solid fa-user",
      label: t("TabStats"),
      sections: [
        ...(abilities.length ? [{ type: "abilities", abilities }] : []),
        ...restSection(rests),
        ...(resources.length ? [{ title: t("Resources"), rows: resources }] : []),
        ...(saves.length ? [{ title: t("Saves"), rows: saves }] : []),
        ...(skills.length ? [{ title: t("Skills"), rows: skills }] : [])
      ]
    });
  }

  /* Combat, in the desktop's own order: options, strikes, then the three
     action panels. Every section is conditional — a creature with nothing
     but exploration activities must not get an empty Strikes list. */
  if (conditions.length || strikes.length || activities.length
    || toggles.length || exploration.length || downtime.length) {
    tabs.push({
      id: "combat",
      icon: "fa-solid fa-hand-fist",
      label: t("TabCombat"),
      sections: [
        ...conditionsSection(conditions),
        ...(toggles.length ? [{ title: t("Toggles"), rows: toggles }] : []),
        ...(strikes.length ? [{ title: t("Strikes"), rows: strikes }] : []),
        ...(activities.length ? [{ title: t("TabActions"), rows: activities }] : []),
        ...(exploration.length ? [{ title: t("Exploration"), rows: exploration }] : []),
        ...(downtime.length ? [{ title: t("Downtime"), rows: downtime }] : [])
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

  tabs.push(...effectsTab(effects));

  return {
    subtitle,
    hp: hpOf(actor),
    ac: attempt("ac", () => num(at(actor, "attributes.ac.value"), system.attributes?.ac?.value), null),
    applyHp: makeApplyHp(actor),
    applyTempHp: makeApplyTempHp(actor),
    stats,
    tabs
  };
}
