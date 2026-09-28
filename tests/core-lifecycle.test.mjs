import assert from "node:assert/strict";
import test from "node:test";

import { ServiceRegistry } from "../scripts/core/registry.mjs";
import { ROOT_ATTRS } from "../scripts/core/constants.mjs";
import { UIState } from "../scripts/responsive/ui-state.mjs";

const withoutExpectedErrors = (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
};

test("UIState.clear preserves attributes owned by theme and shell services", () => {
  const attributes = new Map(Object.values(ROOT_ATTRS).map((name) => [name, "value"]));
  const properties = new Map();
  globalThis.document = {
    documentElement: {
      removeAttribute: (name) => attributes.delete(name),
      style: { removeProperty: (name) => properties.delete(name) }
    }
  };

  UIState.clear();

  assert.equal(attributes.has(ROOT_ATTRS.ACTIVE), false);
  assert.equal(attributes.has(ROOT_ATTRS.DEVICE), false);
  assert.equal(attributes.has(ROOT_ATTRS.THEME), true);
  assert.equal(attributes.has(ROOT_ATTRS.SYSTEM), true);
  assert.equal(attributes.has(ROOT_ATTRS.SHEET_ONLY), true);
});

test("ServiceRegistry rolls back a partially failed enable", () => {
  const calls = [];
  const registry = new ServiceRegistry();
  registry.add({
    name: "failure",
    shouldEnable: () => true,
    enable: () => { calls.push("enable"); throw new Error("boom"); },
    disable: () => calls.push("disable")
  });

  withoutExpectedErrors(() => registry.reconcile({}));

  assert.deepEqual(calls, ["enable", "disable"]);
  assert.equal(registry.isEnabled("failure"), false);
});

test("ServiceRegistry retains enabled state when disable fails", () => {
  const registry = new ServiceRegistry();
  registry.add({
    name: "sticky",
    shouldEnable: () => true,
    enable: () => {},
    disable: () => { throw new Error("still active"); }
  });
  registry.reconcile({});

  withoutExpectedErrors(() => registry.disableAll());

  assert.equal(registry.isEnabled("sticky"), true);
});

test("ServiceRegistry isolates a failed shouldEnable predicate", () => {
  const registry = new ServiceRegistry();
  let healthyEnabled = false;
  registry.add({
    name: "broken-predicate",
    shouldEnable: () => { throw new Error("cannot decide"); },
    enable: () => {},
    disable: () => {}
  });
  registry.add({
    name: "healthy",
    shouldEnable: () => true,
    enable: () => { healthyEnabled = true; },
    disable: () => {}
  });

  withoutExpectedErrors(() => registry.reconcile({}));

  assert.equal(healthyEnabled, true);
  assert.equal(registry.isEnabled("healthy"), true);
});
