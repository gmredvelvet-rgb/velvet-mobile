import assert from "node:assert/strict";
import test from "node:test";

/** The rows of every tab section, keyed by label. */
const rowsByLabel = (model) => new Map((model.tabs ?? [])
  .flatMap((tab) => tab.sections ?? [])
  .flatMap((section) => section.rows ?? [])
  .map((row) => [row.label, row]));

const setup = (systemId) => {
  const posted = [];
  globalThis.CONFIG = { Item: { typeLabels: {} }, PF2E: { Item: { typeLabels: {} } }, DND5E: {}, statusEffects: [] };
  globalThis.game = {
    system: { id: systemId },
    user: { isGM: true },
    i18n: { localize: (key) => key, has: () => false },
    settings: { get: () => undefined },
    modules: new Map()
  };
  globalThis.ui = { notifications: { warn: (message) => posted.push(`warn:${message}`) } };
  globalThis.ChatMessage = { create: async (data) => posted.push(`plain:${data.content}`), getSpeaker: () => ({}) };
  globalThis.foundry = { utils: { escapeHTML: (value) => String(value) } };
  return posted;
};

const item = (type, name, extra = {}) => ({
  id: name.toLowerCase().replaceAll(" ", "-"),
  name,
  type,
  img: `${type}.webp`,
  system: { description: { value: `<p>${name}</p>` }, ...extra.system },
  ...extra
});

test("PF2e: passive features have nothing to use, and posting them never needs a missing card", async () => {
  const posted = setup("pf2e");
  const cardless = (type, name) => item(type, name, {
    toMessage: async () => { throw new Error(`Failed to load template "systems/pf2e/templates/chat/${type}-card.hbs"`); }
  });
  const items = [
    cardless("ancestry", "Minotaur"),
    cardless("deity", "Milani"),
    cardless("background", "Gladiator"),
    item("feat", "Strategic Strike", { system: { actionType: { value: "passive" } }, toMessage: async () => posted.push("card:feat") }),
    item("action", "Devise a Stratagem", { system: { actionType: { value: "action" }, actions: { value: 1 } }, toMessage: async () => posted.push("card:action") }),
    item("weapon", "Longsword", { toMessage: async () => posted.push("card:weapon") }),
    item("consumable", "Healing Potion", { consume: async () => posted.push("consumed") })
  ];
  const actor = { type: "character", name: "Asterion", system: {}, items: { contents: items }, itemTypes: {} };

  const { model } = await import("../scripts/sheet/adapters/pf2e.mjs");
  const rows = rowsByLabel(model(actor));

  for (const name of ["Minotaur", "Milani", "Gladiator", "Strategic Strike"]) {
    assert.ok(rows.has(name), `${name} is listed`);
    assert.equal(rows.get(name).onTap, undefined, `${name} has no use`);
  }
  assert.equal(typeof rows.get("Devise a Stratagem")?.onTap, "function", "an action is still used");
  assert.equal(rows.get("Longsword")?.onTap, undefined, "a weapon is not 'used' from the inventory");
  assert.equal(typeof rows.get("Healing Potion")?.onTap, "function", "a consumable is used");

  await rows.get("Healing Potion").onTap();
  assert.deepEqual(posted, ["consumed"]);

  // Send to chat: a plain message where PF2e has no card, the card otherwise.
  const chat = (name) => rows.get(name).menu.find((entry) => entry.id === "chat").onTap();
  await chat("Milani");
  await chat("Strategic Strike");
  assert.match(posted[1], /^plain:.*Milani/);
  assert.equal(posted[2], "card:feat");
  assert.ok(!posted.some((entry) => entry.startsWith("warn:")), "no error reached the user");
});

test("D&D 5e: only items with a usable activity keep their use", async () => {
  setup("dnd5e");
  const activities = (...canUse) => ({ filter: (fn) => canUse.map((value) => ({ canUse: value })).filter(fn) });
  const used = [];
  const dndItem = (type, name, acts) => item(type, name, {
    system: { activities: acts },
    use: async () => used.push(name),
    displayCard: async () => used.push(`card:${name}`)
  });
  const feats = [dndItem("feat", "Darkvision", activities()), dndItem("feat", "Second Wind", activities(true))];
  const weapons = [dndItem("weapon", "Longsword", activities(true))];
  const loot = [dndItem("loot", "Gold Ring", activities()), dndItem("consumable", "Potion of Healing", activities(true))];
  const actor = {
    type: "character",
    name: "Tester",
    system: { attributes: {}, abilities: {}, skills: {} },
    items: { contents: [...feats, ...weapons, ...loot] },
    itemTypes: { feat: feats, weapon: weapons, spell: [] }
  };

  const { model } = await import("../scripts/sheet/adapters/dnd5e.mjs");
  const rows = rowsByLabel(model(actor));

  assert.equal(rows.get("Darkvision")?.onTap, undefined, "a passive feature has no use");
  assert.equal(rows.get("Gold Ring")?.onTap, undefined, "loot has no use");
  for (const name of ["Second Wind", "Longsword", "Potion of Healing"]) {
    assert.equal(typeof rows.get(name)?.onTap, "function", `${name} is used`);
  }
  await rows.get("Second Wind").onTap();
  assert.deepEqual(used, ["Second Wind"], "a feature with an activity runs it rather than posting its card");
});
