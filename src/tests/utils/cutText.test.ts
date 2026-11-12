import test from "node:test";
import assert from "node:assert/strict";
import { cutText } from "../../utils/cutText.js";

test("cutText_cutInsideEmoji_dropsHighSurrogate", () => {
  // « ab😀c » coupé à 4 : la moitié haute de l'émoji tomberait juste avant « … ».
  assert.equal(cutText("ab\u{1F600}c", 4), "ab…");
});

test("cutText_cutAfterPair_keepsPair", () => {
  assert.equal(cutText("ab\u{1F600}cd", 5), "ab\u{1F600}…");
});

test("cutText_shortText_unchanged", () => {
  assert.equal(cutText("abc", 3), "abc");
});
