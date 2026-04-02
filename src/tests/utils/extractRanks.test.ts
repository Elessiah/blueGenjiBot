import test from "node:test";
import assert from "node:assert/strict";

import { extractRanks } from "../../utils/extractRanks.js";
import { ranks } from "../../utils/globals.js";

test("extractRanks parses known rank words from message", async () => {
  const result = await extractRanks(
    {} as never,
    { content: "Need grand master and celeste players" } as never,
    true
  );
  assert.deepEqual(result, ["gm", "cel"]);
});

test("extractRanks returns all ranks when no rank is found and silence is true", async () => {
  const result = await extractRanks(
    {} as never,
    { content: "Need players for scrim tonight" } as never,
    true
  );
  assert.deepEqual(result, ranks);
});
