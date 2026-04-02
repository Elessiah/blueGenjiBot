import test from "node:test";
import assert from "node:assert/strict";

import { servicesWithNoRanks } from "../../utils/servicesWithNoRanks.js";

test("servicesWithNoRanks returns true for a no-rank service", async () => {
  const result = await servicesWithNoRanks([
    { name: "lfs", id_service: 1 },
    { name: "lfcast", id_service: 2 }
  ]);
  assert.equal(result, true);
});

test("servicesWithNoRanks returns false when all services require ranks", async () => {
  const result = await servicesWithNoRanks([
    { name: "lfs", id_service: 1 },
    { name: "lfsub", id_service: 2 }
  ]);
  assert.equal(result, false);
});
