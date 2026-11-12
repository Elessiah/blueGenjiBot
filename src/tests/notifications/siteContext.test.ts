import test from "node:test";
import assert from "node:assert/strict";

import { MAX_SITE_CONTEXT_LENGTH, sanitizeSiteContext } from "../../notifications/siteContext.js";
import { parseLiveAnnouncement } from "../../notifications/liveAnnouncement.js";

test("sanitizeSiteContext_safeLabel_keptAsIs", () => {
  assert.equal(sanitizeSiteContext("live-announce tournoi-7 match-12,13,…+4", "x"), "live-announce tournoi-7 match-12,13,…+4");
});

test("sanitizeSiteContext_lineBreakOrMarkdown_replacedByHyphen", () => {
  assert.equal(sanitizeSiteContext("a\nb*c_d:e`f", "x"), "a-b-c-d-e-f");
});

test("sanitizeSiteContext_tooLong_cutWithVisibleEllipsis", () => {
  const actual = sanitizeSiteContext("a".repeat(MAX_SITE_CONTEXT_LENGTH + 1), "x");

  assert.equal(actual, `${"a".repeat(MAX_SITE_CONTEXT_LENGTH - 1)}…`);
});

test("sanitizeSiteContext_blankOrNotAString_returnsFallback", () => {
  assert.equal(sanitizeSiteContext("   ", "site"), "site");
  assert.equal(sanitizeSiteContext(7, "site"), "site");
});

test("parseLiveAnnouncement_contextWithUnderscores_sameSanitizerAsNotifications", () => {
  const request = parseLiveAnnouncement({ message: "En direct", streamUrl: "https://www.twitch.tv/bluegenji", context: "__live__" });

  assert.equal(request?.context, "--live--");
});
