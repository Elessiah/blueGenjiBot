import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeCategories,
  parseSent,
  previewStaffMessage,
  sendStaffMessage,
  siteConfig,
  type StaffMessageCall,
} from "../../tournament/siteStaffMessage.js";

// Appel du bot vers le site (/message-tournoi) : boucle locale, jeton, codes seuls, jamais d'exception.

const config = { baseUrl: "http://127.0.0.1:3000", token: "tok" };
const call: StaffMessageCall = { discordId: "100000000000000009", tournamentId: 12, categories: ["ALL"], message: "Salut" };
const previewBody = {
  mode: "preview",
  tournament: { id: 12, name: "Coupe" },
  recipients: { total: 3, reachable: 2, withoutDiscord: 1, optedOut: 0 },
};

function respond(status: number, body: unknown): typeof fetch {
  return (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;
}

test("siteConfig_loopbackUrlAndToken_returnsConfigWithoutTrailingSlash", () => {
  assert.deepEqual(siteConfig({ SITE_INTERNAL_URL: "http://127.0.0.1:3000/", SITE_INTERNAL_TOKEN: "tok" }), config);
});

test("siteConfig_missingToken_returnsNull", () => {
  assert.equal(siteConfig({ SITE_INTERNAL_URL: "http://127.0.0.1:3000" }), null);
});

test("siteConfig_missingUrl_returnsNull", () => {
  assert.equal(siteConfig({ SITE_INTERNAL_TOKEN: "tok" }), null);
});

test("siteConfig_publicHttpsUrl_returnsNull", () => {
  assert.equal(siteConfig({ SITE_INTERNAL_URL: "https://bluegenji-esport.fr", SITE_INTERNAL_TOKEN: "tok" }), null);
});

test("previewStaffMessage_ok_postsModeAndTokenWithoutFollowingRedirects", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(JSON.stringify(previewBody), { status: 200 });
  }) as unknown as typeof fetch;

  const actual = await previewStaffMessage(config, call, fetchImpl);

  assert.deepEqual(actual, { ok: true, data: { tournament: previewBody.tournament, recipients: previewBody.recipients } });
  assert.equal(seen?.url, "http://127.0.0.1:3000/api/internal/tournament-message");
  assert.equal((seen?.init.headers as Record<string, string>)["x-internal-token"], "tok");
  assert.equal(seen?.init.redirect, "error");
  assert.deepEqual(JSON.parse(String(seen?.init.body)), { mode: "preview", ...call });
});

test("previewStaffMessage_siteRefusesWithCode_returnsThatCode", async () => {
  const actual = await previewStaffMessage(config, call, respond(403, { error: "FORBIDDEN" }));

  assert.deepEqual(actual, { ok: false, code: "FORBIDDEN" });
});

test("previewStaffMessage_siteRefusesWithSentence_returnsBadResponse", async () => {
  const actual = await previewStaffMessage(config, call, respond(400, { error: "Something broke for <@1>" }));

  assert.deepEqual(actual, { ok: false, code: "SITE_BAD_RESPONSE" });
});

test("previewStaffMessage_connectionRefused_returnsUnreachable", async () => {
  const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;

  const actual = await previewStaffMessage(config, call, fetchImpl);

  assert.deepEqual(actual, { ok: false, code: "SITE_UNREACHABLE" });
});

test("previewStaffMessage_timeout_returnsTimeout", async () => {
  const fetchImpl = (async () => { throw new DOMException("timed out", "TimeoutError"); }) as unknown as typeof fetch;

  const actual = await previewStaffMessage(config, call, fetchImpl);

  assert.deepEqual(actual, { ok: false, code: "SITE_TIMEOUT" });
});

test("previewStaffMessage_errorPageNotJson_returnsUnreachable", async () => {
  const actual = await previewStaffMessage(config, call, respond(502, "<html>Bad gateway</html>"));

  assert.deepEqual(actual, { ok: false, code: "SITE_UNREACHABLE" });
});

test("previewStaffMessage_malformedCounts_returnsBadResponse", async () => {
  const actual = await previewStaffMessage(config, call, respond(200, { ...previewBody, recipients: { total: "3" } }));

  assert.deepEqual(actual, { ok: false, code: "SITE_BAD_RESPONSE" });
});

test("sendStaffMessage_ok_returnsDelivery", async () => {
  const body = { ...previewBody, mode: "send", delivery: { sent: 2, failed: 0, skipped: 1, pushed: 4, botUnreachable: false } };

  const actual = await sendStaffMessage(config, call, respond(200, body));

  assert.deepEqual(actual, { ok: true, data: { tournament: body.tournament, recipients: body.recipients, delivery: body.delivery } });
});

test("parseSent_negativeCount_returnsNull", () => {
  assert.equal(parseSent({ ...previewBody, delivery: { sent: -1, failed: 0, skipped: 0, pushed: 0 } }), null);
});

test("normalizeCategories_allAmongOthers_returnsAllOnly", () => {
  assert.deepEqual(normalizeCategories(["OWNERS", "ALL"]), ["ALL"]);
});

test("normalizeCategories_nothingKnown_returnsAll", () => {
  assert.deepEqual(normalizeCategories(["FANS"]), ["ALL"]);
});

test("normalizeCategories_someKnown_returnsMenuOrder", () => {
  assert.deepEqual(normalizeCategories(["OWNERS", "PLAYERS", "FANS"]), ["PLAYERS", "OWNERS"]);
});
