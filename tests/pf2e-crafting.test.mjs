import assert from "node:assert/strict";
import test from "node:test";

const setup = () => {
  const calls = [];
  globalThis.CONFIG = { Item: { typeLabels: {} }, PF2E: { Item: { typeLabels: {} } }, statusEffects: [] };
  globalThis.ChatMessage = { create: async (data) => calls.push(["chat", data.content]), getSpeaker: () => ({}) };
  globalThis.ui = { notifications: { warn: (m) => calls.push(["warn", m]), info: (m) => calls.push(["info", m]) } };
  globalThis.foundry = { utils: { escapeHTML: (v) => String(v) } };
  globalThis.document = { createElement: () => ({ dataset: {} }) };
  globalThis.game = {
    system: { id: "pf2e" },
    user: { id: "u1", isGM: false },
    i18n: { localize: (key) => key.split(".").at(-1), has: () => false },
    settings: { get: () => undefined },
    modules: new Map(),
    pf2e: {
      actions: { craft: async (options) => calls.push(["craft", options.item.name, options.quantity, options.difficultyClass.value]) },
      Coins: { fromPrice: (price, quantity) => ({ toString: () => `${price.value * quantity} gp` }) }
    }
  };
  return calls;
};

const formulaItem = (name, level) => ({ name, level, img: `${name}.webp`, price: { value: 3 }, system: { description: { value: name } } });

const alchemist = (calls) => {
  const elixir = formulaItem("Elixir of Life", 1);
  const bomb = formulaItem("Alchemist's Fire", 1);
  const known = [
    { uuid: "Compendium.pf2e.equipment-srd.Item.b", item: bomb, dc: 15, batchSize: 4 },
    { uuid: "Compendium.pf2e.equipment-srd.Item.a", item: elixir, dc: 15, batchSize: 4 }
  ];
  const advanced = {
    slug: "advanced-alchemy",
    label: "Advanced Alchemy",
    isAlchemical: true,
    isPrepared: true,
    isDailyPrep: true,
    resource: "infused-reagents",
    maxSlots: 0,
    getSheetData: async () => ({
      maxItemLevel: 1,
      remainingSlots: 0,
      resource: { slug: "infused-reagents", label: "Infused Reagents", value: 3, max: 5 },
      resourceCost: 2,
      prepared: [{ uuid: known[1].uuid, item: elixir, quantity: 4, expended: false, isSignatureItem: true }]
    }),
    setFormulaQuantity: async (index, direction) => calls.push(["quantity", index, direction]),
    craft: async () => calls.push(["ability-craft"])
  };
  return {
    type: "character",
    name: "Alchemist",
    system: { crafting: { formulas: known.map(({ uuid }) => ({ uuid })) } },
    flags: { pf2e: {} },
    items: { contents: [] },
    itemTypes: {},
    updateResource: async (slug, value) => calls.push(["resource", slug, value]),
    crafting: {
      abilities: { contents: [advanced] },
      getFormulas: async () => known,
      performDailyCrafting: async () => calls.push(["daily"])
    }
  };
};

test("PF2e: an alchemist gets a Crafting tab with Advanced Alchemy, daily crafting and formulas", async () => {
  const calls = setup();
  const { model } = await import("../scripts/sheet/adapters/pf2e.mjs");
  const tab = model(alchemist(calls)).tabs.find((entry) => entry.id === "crafting");
  assert.ok(tab, "the tab exists");

  const sections = await tab.sections[0].load();
  assert.deepEqual(sections.map((section) => section.title), ["Advanced Alchemy", "DailyCrafting", "Formulas"]);

  const [advanced, daily, formulas] = sections;
  const [reagents, elixir] = advanced.rows;
  assert.equal(reagents.badge, "3/5");
  await reagents.actions[1].onTap();
  assert.deepEqual(calls.at(-1), ["resource", "infused-reagents", 4]);

  assert.equal(elixir.label, "Elixir of Life");
  assert.equal(elixir.onTap, undefined, "alchemical formulas are made by daily crafting, not one by one");
  await elixir.actions[1].onTap();
  assert.deepEqual(calls.at(-1), ["quantity", 0, "increase"]);

  await daily.rows[0].onTap();
  assert.deepEqual(calls.at(-1), ["daily"]);

  assert.deepEqual(formulas.rows.map((row) => row.label), ["Alchemist's Fire", "Elixir of Life"]);
  await formulas.rows[0].onTap();
  assert.deepEqual(calls.at(-1), ["craft", "Alchemist's Fire", 4, 15]);
  assert.ok(!calls.some(([kind]) => kind === "warn"), "nothing failed");
});

test("PF2e: a character with no formulas still gets the tab, as on the desktop", async () => {
  setup();
  const { model } = await import("../scripts/sheet/adapters/pf2e.mjs");
  const actor = {
    type: "character",
    name: "Thaumaturge",
    system: { crafting: { formulas: [] } },
    items: { contents: [] },
    itemTypes: {},
    crafting: { abilities: { contents: [] }, getFormulas: async () => [] }
  };
  const tab = model(actor).tabs.find((entry) => entry.id === "crafting");
  assert.ok(tab, "the tab exists");
  const sections = await tab.sections[0].load();
  assert.deepEqual(sections.map((section) => section.title), ["Formulas"]);
  assert.deepEqual(sections[0].rows, []);
  assert.equal(sections[0].empty, "NoFormulas", "an empty list says how formulas are learned");
});

test("PF2e: NPCs, which have no crafting, get no tab", async () => {
  setup();
  const { model } = await import("../scripts/sheet/adapters/pf2e.mjs");
  const npc = { type: "npc", name: "Goblin", system: {}, items: { contents: [] }, itemTypes: {} };
  assert.ok(!model(npc).tabs.some((entry) => entry.id === "crafting"));
});
