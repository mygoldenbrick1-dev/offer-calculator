import test from "node:test";
import assert from "node:assert/strict";

import { DEAL_STORAGE_KEY, saveDeal } from "../src/dealStorage.js";

function memoryStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (key, nextValue) => {
      assert.equal(key, DEAL_STORAGE_KEY);
      value = nextValue;
    },
    read: () => JSON.parse(value),
  };
}

test("saves the newest complete deal first", () => {
  const storage = memoryStorage(JSON.stringify([{ id: "older" }]));
  const saved = saveDeal({ address: "1100 Main St", mao: 101500 }, storage);

  assert.equal(saved.address, "1100 Main St");
  assert.equal(storage.read()[0].mao, 101500);
  assert.equal(storage.read()[1].id, "older");
});

test("recovers from malformed saved data", () => {
  const storage = memoryStorage("not-json");

  saveDeal({ address: "Test property" }, storage);
  assert.equal(storage.read().length, 1);
});