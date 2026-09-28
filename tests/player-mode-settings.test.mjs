import assert from "node:assert/strict";
import test from "node:test";

test("player mode settings are registered per non-GM and override only that user", async () => {
  const registered = new Map();
  const values = new Map([
    ["velvet-mobile.mode", "auto"],
    ["velvet-mobile.userMode-player-1", "phone"],
    ["velvet-mobile.userMode-player-2", "own"]
  ]);

  globalThis.game = {
    user: { id: "player-1" },
    users: { contents: [
      { id: "gm-1", name: "GM", isGM: true },
      { id: "player-1", name: "Alice", isGM: false },
      { id: "player-2", name: "Bob", isGM: false }
    ] },
    i18n: { localize: (key, data) => `${key}:${data?.name ?? ""}` },
    modules: new Map(),
    settings: {
      register: (namespace, key, config) => registered.set(`${namespace}.${key}`, config),
      get: (namespace, key) => values.get(`${namespace}.${key}`)
    }
  };

  const { Settings } = await import("../scripts/core/settings.mjs");
  Settings.registerPlayerModes();

  assert.deepEqual([...registered.keys()], [
    "velvet-mobile.userMode-player-1",
    "velvet-mobile.userMode-player-2"
  ]);
  assert.match(registered.get("velvet-mobile.userMode-player-1").name, /Alice/);
  assert.equal(Settings.mode, "phone");

  game.user = { id: "player-2" };
  assert.equal(Settings.mode, "auto");

  game.user = { id: "gm-1" };
  assert.equal(Settings.mode, "auto");
});

/**
 * Mimic Foundry during init: no game.users, game.user still null, only the
 * raw world data and game.userId. A fresh module instance per call.
 * @param {string} userId
 */
async function initAs(userId) {
  const registered = new Map();
  const values = new Map([
    ["velvet-mobile.mode", "auto"],
    ["velvet-mobile.userMode-player-1", "off"]
  ]);
  globalThis.CONST = { USER_ROLES: { PLAYER: 1, ASSISTANT: 3, GAMEMASTER: 4 } };
  globalThis.game = {
    userId,
    user: null,
    data: { users: [
      { _id: "gm-1", name: "GM", role: 4 },
      { _id: "player-1", name: "Alice", role: 1 }
    ] },
    i18n: { localize: (key) => key },
    modules: new Map([["velvet-license-hub", { active: true }]]),
    settings: {
      register: (namespace, key, config) => registered.set(`${namespace}.${key}`, config),
      get: (namespace, key) => values.get(`${namespace}.${key}`)
    }
  };
  const { Settings } = await import(`../scripts/core/settings.mjs?init-${userId}`);
  Settings.register({});
  return { Settings, registered };
}

test("a player's override already applies during init", async () => {
  const { Settings, registered } = await initAs("player-1");
  assert.ok(registered.has("velvet-mobile.userMode-player-1"));
  assert.equal(Settings.mode, "off");
});

test("the GM gets no override of their own during init", async () => {
  const { Settings, registered } = await initAs("gm-1");
  assert.ok(![...registered.keys()].some((key) => key.includes("userMode-")));
  assert.equal(Settings.mode, "auto");
});
