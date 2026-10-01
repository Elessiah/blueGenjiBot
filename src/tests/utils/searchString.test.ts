import test from "node:test";
import assert from "node:assert/strict";

import { searchString } from "../../utils/searchString.js";

test("searchString finds an exact word", async () => {
  const result = await searchString("eu", "we play in eu tonight");
  assert.equal(result, true);
});

test("searchString does not match partial words", async () => {
  const result = await searchString("eu", "we play in europe tonight");
  assert.equal(result, false);
});

test("searchString is case-sensitive", async () => {
  const result = await searchString("eu", "we play in EU tonight");
  assert.equal(result, false);
});

test("searchString repond pareil a chaque appel (aucun etat entre deux recherches)", async () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(await searchString("eu", "eu eu"), true);
    assert.equal(await searchString("na", "eu only"), false);
  }
});
