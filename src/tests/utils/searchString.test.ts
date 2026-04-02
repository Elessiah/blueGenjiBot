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
