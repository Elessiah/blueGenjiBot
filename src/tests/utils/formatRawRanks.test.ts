import test from "node:test";
import assert from "node:assert/strict";

import { formatRawRanks } from "../../utils/formatRawRanks.js";
import { rankChoices } from "../../config/rankChoices.js";

function rankLabel(value: string): string {
  const choice = rankChoices.find((entry) => entry.value === value);
  if (!choice) {
    throw new Error(`Unknown test rank value: ${value}`);
  }
  return choice.name;
}

test("formatRawRanks formats known ranks in order", async () => {
  const result = await formatRawRanks(["bronze", "gm", "oaa"]);
  const expected = ["bronze", "gm", "oaa"]
    .map((value) => `- **${rankLabel(value)}**\n`)
    .join("");
  assert.equal(result, expected);
});

test("formatRawRanks ignores unknown rank values", async () => {
  const result = await formatRawRanks(["bronze", "unknown", "oaa"]);
  const expected = ["bronze", "oaa"]
    .map((value) => `- **${rankLabel(value)}**\n`)
    .join("");
  assert.equal(result, expected);
});

test("formatRawRanks returns empty string with no input", async () => {
  const result = await formatRawRanks([]);
  assert.equal(result, "");
});
