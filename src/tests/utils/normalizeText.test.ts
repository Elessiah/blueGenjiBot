import test from "node:test";
import assert from "node:assert/strict";

import { normalizeText } from "../../utils/normalizeText.js";

test("normalizeText removes accents and lowercases text", () => {
  const result = normalizeText("Celeste ETERNITE et GRAND MAITRE");
  assert.equal(result, "celeste eternite et grand maitre");
});

test("normalizeText keeps punctuation and numbers", () => {
  const result = normalizeText("Rank GM 3, now!");
  assert.equal(result, "rank gm 3, now!");
});
