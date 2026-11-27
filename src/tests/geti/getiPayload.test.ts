import test from "node:test";
import assert from "node:assert/strict";

import {
  batchGetiPosts,
  GETI_BATCH_MAX_BYTES,
  isGetiChannel,
  isGetiPost,
  isGetiRelayMessage,
  getiChannel,
  getiRetentionMs,
  GETI_BOT_USER_ID,
  GETI_CHANNELS,
  toGetiWirePost,
  type GetiSourceMessage,
  type GetiWirePost,
} from "../../geti/getiPayload.js";
import {
  GETI_RETRY_AFTER_MAX_MS,
  resetGetiConfigRefusalLog,
  sendGetiOp,
  SITE_GETI_DELETE_PATH,
  SITE_GETI_POSTS_PATH,
  SITE_GETI_RECONCILE_PATH,
} from "../../geti/getiSiteClient.js";

// Annonces GETI : forme poussée au site et appel du site (boucle locale, jeton, jamais d'exception).

const LFT_CHANNEL = "679323773559635999";
const OTHER_CHANNEL = "100000000000000555";
const POSTED = Date.parse("2026-11-27T10:00:00.000Z");
const config = { baseUrl: "http://127.0.0.1:3000", token: "tok" };

function userMessage(overrides: Partial<GetiSourceMessage> = {}): GetiSourceMessage {
  return {
    id: "100000000000000901",
    channelId: LFT_CHANNEL,
    content: "LFT support Master 2",
    author: { id: "100000000000000001", username: "fauxjoueur", discriminator: "0", bot: false },
    embeds: [],
    createdTimestamp: POSTED,
    editedTimestamp: null,
    system: false,
    ...overrides,
  };
}

/** En-tête d'un relais de GETI Bot (données de synthèse). */
const RELAY_HEADER = "<@100000000000000011>*(fauxpseudo)* sur [Faux Serveur](https://discord.gg/fauxcode)";

function relayMessage(description: string, overrides: Partial<GetiSourceMessage> = {}): GetiSourceMessage {
  return userMessage({
    content: "",
    author: { id: GETI_BOT_USER_ID, username: "GETI Bot", discriminator: "0", bot: true },
    embeds: [{ description: `${RELAY_HEADER}

> ${description}` }],
    ...overrides,
  });
}

function wirePost(id: string, content = "LFT"): GetiWirePost {
  return toGetiWirePost(userMessage({ id, content }));
}

type Captured = { url: string; init: RequestInit };

function capture(status: number, calls: Captured[]): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("{}", { status });
  }) as unknown as typeof fetch;
}

function respond(status: number): typeof fetch {
  return capture(status, []);
}

test("isGetiChannel_sourceChannel_returnsTrue", () => {
  assert.equal(isGetiChannel(LFT_CHANNEL), true);
});

test("isGetiChannel_otherChannel_returnsFalse", () => {
  assert.equal(isGetiChannel(OTHER_CHANNEL), false);
});

test("isGetiChannel_null_returnsFalse", () => {
  assert.equal(isGetiChannel(null), false);
});

test("isGetiPost_userMessageInSourceChannel_returnsTrue", () => {
  assert.equal(isGetiPost(userMessage()), true);
});

test("isGetiPost_systemMessage_returnsFalse", () => {
  assert.equal(isGetiPost(userMessage({ system: true })), false);
});

test("isGetiPost_otherChannel_returnsFalse", () => {
  assert.equal(isGetiPost(userMessage({ channelId: OTHER_CHANNEL })), false);
});

test("isGetiPost_relayOfGetiBot_returnsTrue", () => {
  assert.equal(isGetiPost(relayMessage("LFP tank")), true);
});

test("isGetiPost_publishedNoticeOfGetiBot_returnsFalse", () => {
  const embeds = [{ description: "Ton annonce a été publié dans **32 autres channels**." }];
  assert.equal(isGetiPost(relayMessage("", { embeds })), false);
});

test("isGetiPost_getiBotWithoutEmbed_returnsFalse", () => {
  assert.equal(isGetiPost(relayMessage("", { embeds: [] })), false);
});

test("isGetiPost_messageOfAnotherBot_returnsFalse", () => {
  const author = { id: "100000000000000090", username: "AutreBot", discriminator: "0", bot: true };

  assert.equal(isGetiPost(relayMessage("LFP tank", { author })), false);
});

test("isGetiPost_messageWithoutAuthor_returnsFalse", () => {
  assert.equal(isGetiPost(userMessage({ author: null })), false);
});

test("getiChannel_scrimChannel_keepsSevenDays", () => {
  assert.deepEqual(getiChannel("930074663340605451"), { id: "930074663340605451", category: "lfs", retentionDays: 7 });
});

test("getiChannel_otherChannel_returnsNull", () => {
  assert.equal(getiChannel(OTHER_CHANNEL), null);
});

test("GETI_CHANNELS_everyCategoryButScrims_keepsFourteenDays", () => {
  const others = GETI_CHANNELS.filter((channel) => channel.category !== "lfs");

  assert.deepEqual(others.map((channel) => channel.retentionDays), [14, 14, 14, 14, 14]);
});

test("getiRetentionMs_scrimChannel_isSevenDays", () => {
  assert.equal(getiRetentionMs({ id: "930074663340605451", category: "lfs", retentionDays: 7 }), 7 * 24 * 60 * 60 * 1000);
});

test("toGetiWirePost_userMessage_copiesTheMessage", () => {
  assert.deepEqual(toGetiWirePost(userMessage()), {
    id: "100000000000000901",
    channelId: LFT_CHANNEL,
    content: "LFT support Master 2",
    author: { id: "100000000000000001", username: "fauxjoueur", discriminator: "0", bot: false },
    embeds: [],
    postedAt: "2026-11-27T10:00:00.000Z",
    editedAt: null,
  });
});

test("toGetiWirePost_editedMessage_setsEditedAt", () => {
  const post = toGetiWirePost(userMessage({ editedTimestamp: POSTED + 60_000 }));

  assert.equal(post.editedAt, "2026-11-27T10:01:00.000Z");
});

test("toGetiWirePost_missingAuthor_sendsAnEmptyAuthor", () => {
  const post = toGetiWirePost(userMessage({ author: null }));

  assert.deepEqual(post.author, { id: null, username: null, discriminator: null, bot: false });
});

test("toGetiWirePost_contentOver4000Characters_isTruncated", () => {
  const post = toGetiWirePost(userMessage({ content: "a".repeat(4001) }));

  assert.equal(post.content.length, 4000);
});

test("toGetiWirePost_elevenEmbeds_keepsTen", () => {
  const post = toGetiWirePost(userMessage({ embeds: Array.from({ length: 11 }, () => ({ description: "LFP" })) }));

  assert.equal(post.embeds.length, 10);
});

test("toGetiWirePost_embed_mapsAuthorTitleFieldsAndFooter", () => {
  const post = toGetiWirePost(
    relayMessage("LFP tank", {
      embeds: [
        {
          author: { name: "fauxpseudo" },
          title: "Recrutement",
          description: "LFP tank",
          fields: [{ name: "Rang", value: "Master" }],
          footer: { text: "GETI" },
        },
      ],
    }),
  );

  assert.deepEqual(post.embeds, [
    { authorName: "fauxpseudo", title: "Recrutement", description: "LFP tank", fields: [{ name: "Rang", value: "Master" }], footerText: "GETI" },
  ]);
});

test("toGetiWirePost_bareEmbed_sendsNulls", () => {
  const post = toGetiWirePost(relayMessage("x", { embeds: [{}] }));

  assert.deepEqual(post.embeds, [{ authorName: null, title: null, description: null, fields: [], footerText: null }]);
});

test("batchGetiPosts_noPost_returnsNoBatch", () => {
  assert.deepEqual(batchGetiPosts([]), []);
});

test("batchGetiPosts_twentyPosts_fitInOneBatch", () => {
  const posts = Array.from({ length: 20 }, (_, index) => wirePost(`1000000000000009${String(index).padStart(2, "0")}`));

  assert.deepEqual(batchGetiPosts(posts).map((batch) => batch.length), [20]);
});

test("batchGetiPosts_twentyOnePosts_splitInTwoBatches", () => {
  const posts = Array.from({ length: 21 }, (_, index) => wirePost(`1000000000000009${String(index).padStart(2, "0")}`));

  assert.deepEqual(batchGetiPosts(posts).map((batch) => batch.length), [20, 1]);
});

test("batchGetiPosts_postsOverTheByteCap_startANewBatch", () => {
  // Quatre annonces d'environ 60 Ko : trois tiennent sous le plafond d'un lot, la quatrième en ouvre un autre.
  const heavy = { ...wirePost("100000000000000901"), content: "a".repeat(60_000) };

  const batches = batchGetiPosts([heavy, heavy, heavy, heavy]);

  assert.deepEqual(batches.map((batch) => batch.length), [3, 1]);
});

test("batchGetiPosts_singlePostOverTheByteCap_travelsAlone", () => {
  const oversized = { ...wirePost("100000000000000901"), content: "a".repeat(GETI_BATCH_MAX_BYTES + 1) };

  const batches = batchGetiPosts([wirePost("100000000000000902"), oversized, wirePost("100000000000000903")]);

  assert.deepEqual(batches.map((batch) => batch.length), [1, 1, 1]);
});

test("sendGetiOp_upsert_postsTheBatchToThePostsRouteWithTheToken", async () => {
  const calls: Captured[] = [];
  const posts = [wirePost("100000000000000901")];

  await sendGetiOp(config, { kind: "upsert", posts }, capture(200, calls));

  assert.equal(calls[0].url, `http://127.0.0.1:3000${SITE_GETI_POSTS_PATH}`);
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, { "content-type": "application/json", "x-internal-token": "tok" });
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { posts });
});

test("sendGetiOp_delete_postsTheIdsToTheDeleteRoute", async () => {
  const calls: Captured[] = [];

  await sendGetiOp(config, { kind: "delete", ids: ["100000000000000901"] }, capture(200, calls));

  assert.equal(calls[0].url, `http://127.0.0.1:3000${SITE_GETI_DELETE_PATH}`);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { ids: ["100000000000000901"] });
});

test("sendGetiOp_reconcile_postsTheWindowToTheReconcileRoute", async () => {
  const calls: Captured[] = [];
  const window = { channelId: LFT_CHANNEL, since: "2026-11-13T10:00:00.000Z", until: "2026-11-27T10:00:00.000Z", ids: ["100000000000000901"] };

  await sendGetiOp(config, { kind: "reconcile", ...window }, capture(200, calls));

  assert.equal(calls[0].url, `http://127.0.0.1:3000${SITE_GETI_RECONCILE_PATH}`);
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), window);
});

test("sendGetiOp_anyCall_followsNoRedirect", async () => {
  const calls: Captured[] = [];

  await sendGetiOp(config, { kind: "delete", ids: ["100000000000000901"] }, capture(200, calls));

  assert.equal(calls[0].init.redirect, "error");
});

test("sendGetiOp_status200_returnsOk", async () => {
  assert.equal(await sendGetiOp(config, { kind: "delete", ids: [] }, respond(200)), "ok");
});

test("sendGetiOp_status400_returnsDrop", async () => {
  assert.equal(await sendGetiOp(config, { kind: "delete", ids: [] }, respond(400)), "drop");
});

test("sendGetiOp_status413_returnsDrop", async () => {
  assert.equal(await sendGetiOp(config, { kind: "delete", ids: [] }, respond(413)), "drop");
});

test("sendGetiOp_status401_returnsRetry", async () => {
  assert.equal(await sendGetiOp(config, { kind: "delete", ids: [] }, respond(401)), "retry");
});

test("sendGetiOp_status403_returnsRetry", async () => {
  assert.equal(await sendGetiOp(config, { kind: "delete", ids: [] }, respond(403)), "retry");
});

test("sendGetiOp_status429_returnsRetry", async () => {
  assert.equal(await sendGetiOp(config, { kind: "delete", ids: [] }, respond(429)), "retry");
});

function tooMany(retryAfter: string | null): typeof fetch {
  return (async () => new Response("{}", { status: 429, headers: retryAfter === null ? {} : { "retry-after": retryAfter } })) as unknown as typeof fetch;
}

test("sendGetiOp_status429WithRetryAfter_waitsThatLongBeforeRetry", async () => {
  const waits: number[] = [];

  const outcome = await sendGetiOp(config, { kind: "delete", ids: [] }, tooMany("12"), async (ms) => { waits.push(ms); });

  assert.equal(outcome, "retry");
  assert.deepEqual(waits, [12_000]);
});

test("sendGetiOp_status429WithHugeRetryAfter_isCapped", async () => {
  const waits: number[] = [];

  await sendGetiOp(config, { kind: "delete", ids: [] }, tooMany("86400"), async (ms) => { waits.push(ms); });

  assert.deepEqual(waits, [GETI_RETRY_AFTER_MAX_MS]);
});

test("sendGetiOp_status429WithUnusableRetryAfter_waitsNothingExtra", async () => {
  for (const header of [null, "", "abc", "-5", "0", "Wed, 21 Oct 2026 07:28:00 GMT"]) {
    const waits: number[] = [];

    await sendGetiOp(config, { kind: "delete", ids: [] }, tooMany(header), async (ms) => { waits.push(ms); });

    assert.deepEqual(waits, [0], String(header));
  }
});

test("sendGetiOp_status503WithRetryAfter_doesNotWait", async () => {
  const waits: number[] = [];
  const unavailable = (async () => new Response("{}", { status: 503, headers: { "retry-after": "30" } })) as unknown as typeof fetch;

  await sendGetiOp(config, { kind: "delete", ids: [] }, unavailable, async (ms) => { waits.push(ms); });

  assert.deepEqual(waits, []);
});

test("sendGetiOp_status503_returnsRetry", async () => {
  assert.equal(await sendGetiOp(config, { kind: "delete", ids: [] }, respond(503)), "retry");
});

test("sendGetiOp_fetchThrows_returnsRetry", async () => {
  const refused = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;

  assert.equal(await sendGetiOp(config, { kind: "delete", ids: [] }, refused), "retry");
});

test("sendGetiOp_tokenRefused_retriesAndLogsAConfigurationError", async (t) => {
  resetGetiConfigRefusalLog();
  const errors = t.mock.method(console, "error", () => undefined);

  const outcome = await sendGetiOp(config, { kind: "delete", ids: ["100000000000000901"] }, capture(401, []));

  assert.equal(outcome, "retry");
  assert.match(String(errors.mock.calls[0]?.arguments[0]), /refus 401/u);
});

test("sendGetiOp_routeMissing_retriesWithoutLogging", async (t) => {
  const errors = t.mock.method(console, "error", () => undefined);

  const outcome = await sendGetiOp(config, { kind: "delete", ids: ["100000000000000901"] }, capture(404, []));

  assert.equal(outcome, "retry");
  assert.equal(errors.mock.callCount(), 0);
});

test("sendGetiOp_tokenRefusedTwice_logsOnce", async (t) => {
  resetGetiConfigRefusalLog();
  const errors = t.mock.method(console, "error", () => undefined);

  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(401));
  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(401));

  assert.equal(errors.mock.callCount(), 1);
});

test("sendGetiOp_refusalThenOkThenRefusal_logsAgainAfterTheSuccess", async (t) => {
  resetGetiConfigRefusalLog();
  const errors = t.mock.method(console, "error", () => undefined);

  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(401));
  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(200));
  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(403));

  assert.equal(errors.mock.callCount(), 2);
  assert.match(String(errors.mock.calls[1]?.arguments[0]), /refus 403/u);
});

test("isGetiRelayMessage_mentionThenNotice_returnsFalse", () => {
  const embeds = [{ description: "<@100000000000000011> Ton annonce a été publiée dans 32 autres channels." }];

  assert.equal(isGetiRelayMessage(embeds), false);
});

test("isGetiRelayMessage_englishHeaderWithOn_returnsTrue", () => {
  const embeds = [{ description: "<@100000000000000011> (fauxpseudo) on [Faux Serveur](https://discord.gg/fauxcode)\n\n> LFT dps" }];

  assert.equal(isGetiRelayMessage(embeds), true);
});

test("sendGetiOp_401Then403_logsEachStatus", async (t) => {
  resetGetiConfigRefusalLog();
  const errors = t.mock.method(console, "error", () => undefined);

  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(401));
  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(403));

  assert.equal(errors.mock.callCount(), 2);
  assert.match(String(errors.mock.calls[1]?.arguments[0]), /refus 403/u);
});

test("sendGetiOp_refusalThenServerErrorThenRefusal_logsAgain", async (t) => {
  resetGetiConfigRefusalLog();
  const errors = t.mock.method(console, "error", () => undefined);

  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(401));
  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(500));
  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(401));

  assert.equal(errors.mock.callCount(), 2);
});

test("sendGetiOp_alternating401And403_logsEachStatusOnce", async (t) => {
  resetGetiConfigRefusalLog();
  const errors = t.mock.method(console, "error", () => undefined);

  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(401));
  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(403));
  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(401));
  await sendGetiOp(config, { kind: "delete", ids: [] }, respond(403));

  assert.equal(errors.mock.callCount(), 2);
});
