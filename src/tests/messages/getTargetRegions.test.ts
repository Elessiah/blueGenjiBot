import test from "node:test";
import assert from "node:assert/strict";

import { getTargetRegions } from "../../messages/getTargetRegions.js";

test("getTargetRegions builds query from requested regions in message", async () => {
  const result = await getTargetRegions(2, "need eu and na players");
  assert.deepEqual(result, {
    query: "ChannelPartner.region = 1 OR ChannelPartner.region = 2",
    requestedRegions: [1, 2]
  });
});

test("getTargetRegions falls back to current region when no region is requested", async () => {
  const result = await getTargetRegions(3, "need players for tonight");
  assert.deepEqual(result, {
    query: "ChannelPartner.region = 3",
    requestedRegions: [3]
  });
});

test("getTargetRegions returns null when current region is ALL and no filter is requested", async () => {
  const result = await getTargetRegions(0, "need players for tonight");
  assert.equal(result, null);
});
