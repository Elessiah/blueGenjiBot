import test from "node:test";
import assert from "node:assert/strict";

import { defineRankRange } from "../../utils/defineRankRange.js";

test("defineRankRange returns full rank range when limits are null", async () => {
  const result = await defineRankRange(null, null);
  assert.deepEqual(result, [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("defineRankRange returns an inclusive range with normal boundaries", async () => {
  const result = await defineRankRange("gold", "diam");
  assert.deepEqual(result, [3, 4, 5]);
});

test("defineRankRange swaps boundaries when max is lower than min", async () => {
  const result = await defineRankRange("gm", "silver");
  assert.deepEqual(result, [2, 3, 4, 5, 6]);
});
