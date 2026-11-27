import test from "node:test";
import assert from "node:assert/strict";

import { GETI_BOT_USER_ID, GETI_CHANNELS, type GetiSourceMessage } from "../../geti/getiPayload.js";
import type { GetiDelivery } from "../../geti/getiQueue.js";
import { GETI_BACKFILL_MAX_PAGES, GetiRelay } from "../../geti/getiRelay.js";
import type { GetiSiteOp } from "../../geti/getiSiteClient.js";

// Relais GETI : création, modification, suppression, rattrapage sur la durée de garde (14 jours, 7 pour les scrims) et réconciliation par salon.

const GETI_CHANNEL_IDS = GETI_CHANNELS.map((channel) => channel.id);
const LFP_CHANNEL = "679323677874978826";
const LFS_CHANNEL = "930074663340605451";
const OTHER_CHANNEL = "100000000000000555";
const NOW = Date.parse("2026-11-27T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

type ReconcileOp = Extract<GetiSiteOp, { kind: "reconcile" }>;
type Pages = Record<string, (before?: string) => GetiSourceMessage[] | Promise<GetiSourceMessage[]>>;

function message(id: string, overrides: Partial<GetiSourceMessage> = {}): GetiSourceMessage {
  return {
    id,
    channelId: LFP_CHANNEL,
    content: "LFP tank Master",
    author: { id: "100000000000000001", username: "fauxjoueur", discriminator: "0", bot: false },
    embeds: [],
    createdTimestamp: NOW - 60_000,
    editedTimestamp: null,
    system: false,
    ...overrides,
  };
}

function relayPost(id: string, overrides: Partial<GetiSourceMessage> = {}): GetiSourceMessage {
  return message(id, {
    content: "",
    author: { id: GETI_BOT_USER_ID, username: "GETI Bot", discriminator: "0", bot: true },
    embeds: [{ description: "<@100000000000000011>*(fauxpseudo)* sur [Faux Serveur](https://discord.gg/fauxcode)\n\n> LFP tank" }],
    ...overrides,
  });
}

function discordError(code: number): Error {
  return Object.assign(new Error("DiscordAPIError"), { code });
}

/** Relais branché sur une file et un historique simulés. */
function harness(options: { pages?: Pages; deliver?: (op: GetiSiteOp) => GetiDelivery } = {}) {
  const ops: GetiSiteOp[] = [];
  const fetched: { channelId: string; before?: string }[] = [];
  const logs: string[] = [];
  const relay: GetiRelay = new GetiRelay({
    queue: {
      enqueue: async (op) => {
        ops.push(structuredClone(op));
        const delivery = options.deliver?.(op) ?? "ok";
        if (delivery === "lost") { relay.noteLost(); }
        return delivery;
      },
    },
    fetchPage: async (channelId, before) => {
      fetched.push({ channelId, before });
      return (await options.pages?.[channelId]?.(before)) ?? [];
    },
    now: () => NOW,
    sleep: async () => undefined,
    log: (line) => { logs.push(line); },
  });
  const upserted = () => ops.flatMap((op) => (op.kind === "upsert" ? op.posts.map((post) => post.id) : []));
  const reconciles = () => ops.filter((op): op is ReconcileOp => op.kind === "reconcile");
  const reconcileOf = (channelId: string) => reconciles().find((op) => op.channelId === channelId);
  return { relay, ops, fetched, logs, upserted, reconciles, reconcileOf };
}

test("onMessage_messageInSourceChannel_pushesItToTheSite", async () => {
  const { relay, ops } = harness();

  await relay.onMessage(message("100000000000000901"));

  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "upsert");
  assert.deepEqual(ops[0].kind === "upsert" ? ops[0].posts.map((post) => post.id) : [], ["100000000000000901"]);
});

test("onMessage_messageInAnotherChannel_isIgnored", async () => {
  const { relay, ops } = harness();

  await relay.onMessage(message("100000000000000901", { channelId: OTHER_CHANNEL }));

  assert.deepEqual(ops, []);
});

test("onMessage_systemMessage_isIgnored", async () => {
  const { relay, ops } = harness();

  await relay.onMessage(message("100000000000000901", { system: true }));

  assert.deepEqual(ops, []);
});

test("onMessage_relayOfGetiBot_pushesItsEmbed", async () => {
  const { relay, ops } = harness();

  await relay.onMessage(relayPost("100000000000000901"));

  assert.equal(ops[0].kind === "upsert" ? ops[0].posts[0].author.id : null, GETI_BOT_USER_ID);
  assert.equal(ops[0].kind === "upsert" ? ops[0].posts[0].embeds.length : 0, 1);
});

test("onMessage_messageOfAnotherBot_isIgnored", async () => {
  const { relay, ops } = harness();
  const author = { id: "100000000000000090", username: "AutreBot", discriminator: "0", bot: true };

  await relay.onMessage(relayPost("100000000000000901", { author }));

  assert.deepEqual(ops, []);
});

test("onDelete_messageOfSourceChannel_removesItFromTheSite", async () => {
  const { relay, ops } = harness();

  await relay.onDelete(LFP_CHANNEL, ["100000000000000901"]);

  assert.deepEqual(ops, [{ kind: "delete", ids: ["100000000000000901"] }]);
});

test("onDelete_messageOfAnotherChannel_isIgnored", async () => {
  const { relay, ops } = harness();

  await relay.onDelete(OTHER_CHANNEL, ["100000000000000901"]);

  assert.deepEqual(ops, []);
});

test("onDelete_noIds_isIgnored", async () => {
  const { relay, ops } = harness();

  await relay.onDelete(LFP_CHANNEL, []);

  assert.deepEqual(ops, []);
});

test("onDelete_hundredAndFiftyIds_sendsTwoCalls", async () => {
  const { relay, ops } = harness();
  const ids = Array.from({ length: 150 }, (_, index) => `100000000000000${String(index).padStart(3, "0")}`);

  await relay.onDelete(LFP_CHANNEL, ids);

  assert.deepEqual(ops.map((op) => (op.kind === "delete" ? op.ids.length : -1)), [100, 50]);
});

test("backfill_recentMessages_pushesThemAndReconcilesEveryChannel", async () => {
  const { relay, upserted, reconciles, reconcileOf, logs } = harness({
    pages: { [LFP_CHANNEL]: () => [message("100000000000000902"), message("100000000000000901")] },
  });

  await relay.backfill();

  assert.deepEqual(upserted(), ["100000000000000902", "100000000000000901"]);
  assert.deepEqual(reconciles().map((op) => op.channelId), [...GETI_CHANNEL_IDS]);
  assert.deepEqual(reconcileOf(LFP_CHANNEL), {
    kind: "reconcile",
    channelId: LFP_CHANNEL,
    since: new Date(NOW - 14 * DAY_MS).toISOString(),
    until: new Date(NOW - 2_000).toISOString(),
    ids: ["100000000000000902", "100000000000000901"],
  });
  assert.equal(logs.at(-1), "[geti] rattrapage : 2 message(s) poussé(s), 6/6 salon(s) réconcilié(s)");
});

test("backfill_messageOlderThanFourteenDays_isLeftOutAndStopsTheChannel", async () => {
  const old = message("100000000000000900", { createdTimestamp: NOW - 14 * DAY_MS - 1 });
  const { relay, upserted, reconcileOf, fetched } = harness({
    pages: { [LFP_CHANNEL]: () => [message("100000000000000901"), old] },
  });

  await relay.backfill();

  assert.deepEqual(upserted(), ["100000000000000901"]);
  assert.deepEqual(reconcileOf(LFP_CHANNEL)?.ids, ["100000000000000901"]);
  assert.equal(fetched.filter((call) => call.channelId === LFP_CHANNEL).length, 1);
});

test("backfill_scrimChannel_readsAndReconcilesSevenDaysOnly", async () => {
  const eightDays = message("100000000000000900", { channelId: LFS_CHANNEL, createdTimestamp: NOW - 8 * DAY_MS });
  const sixDays = message("100000000000000901", { channelId: LFS_CHANNEL, createdTimestamp: NOW - 6 * DAY_MS });
  const { relay, upserted, reconcileOf } = harness({ pages: { [LFS_CHANNEL]: () => [sixDays, eightDays] } });

  await relay.backfill();

  assert.deepEqual(upserted(), ["100000000000000901"]);
  assert.equal(reconcileOf(LFS_CHANNEL)?.since, new Date(NOW - 7 * DAY_MS).toISOString());
  assert.deepEqual(reconcileOf(LFS_CHANNEL)?.ids, ["100000000000000901"]);
});

test("backfill_messageOfAnotherBot_isNotPushedButStaysInTheReconciledIds", async () => {
  const author = { id: "100000000000000090", username: "AutreBot", discriminator: "0", bot: true };
  const { relay, upserted, reconcileOf } = harness({
    pages: { [LFP_CHANNEL]: () => [relayPost("100000000000000901", { author }), relayPost("100000000000000902")] },
  });

  await relay.backfill();

  assert.deepEqual(upserted(), ["100000000000000902"]);
  assert.deepEqual(reconcileOf(LFP_CHANNEL)?.ids, ["100000000000000901", "100000000000000902"]);
});

test("backfill_fullPage_readsTheNextOneBeforeItsOldestMessage", async () => {
  const fullPage = Array.from({ length: 100 }, (_, index) =>
    message(`100000000000001${String(index).padStart(3, "0")}`, { createdTimestamp: NOW - 1_000 * (index + 1) }),
  );
  const { relay, fetched, reconcileOf } = harness({
    pages: { [LFP_CHANNEL]: (before) => (before === undefined ? fullPage : [message("100000000000000901", { createdTimestamp: NOW - DAY_MS })]) },
  });

  await relay.backfill();

  assert.deepEqual(fetched.filter((call) => call.channelId === LFP_CHANNEL), [
    { channelId: LFP_CHANNEL, before: undefined },
    { channelId: LFP_CHANNEL, before: "100000000000001099" },
  ]);
  assert.equal(reconcileOf(LFP_CHANNEL)?.ids.length, 101);
});

test("backfill_systemMessage_isNotPushedButStaysInTheReconciledIds", async () => {
  const { relay, upserted, reconcileOf } = harness({
    pages: { [LFP_CHANNEL]: () => [message("100000000000000901", { system: true })] },
  });

  await relay.backfill();

  assert.deepEqual(upserted(), []);
  assert.deepEqual(reconcileOf(LFP_CHANNEL)?.ids, ["100000000000000901"]);
});

test("backfill_pageCapReached_reconcilesOnlyThePartThatWasRead", async () => {
  let pageIndex = 0;
  const { relay, fetched, reconcileOf } = harness({
    pages: {
      [LFP_CHANNEL]: () => {
        const page = pageIndex;
        pageIndex += 1;
        return Array.from({ length: 100 }, (_, index) =>
          message(`1000000000000${String(page).padStart(2, "0")}${String(index).padStart(3, "0")}`, {
            createdTimestamp: NOW - 1_000 * (page * 100 + index + 1),
          }),
        );
      },
    },
  });

  await relay.backfill();

  assert.equal(fetched.filter((call) => call.channelId === LFP_CHANNEL).length, GETI_BACKFILL_MAX_PAGES);
  const oldestRead = NOW - 1_000 * GETI_BACKFILL_MAX_PAGES * 100;
  assert.equal(reconcileOf(LFP_CHANNEL)?.since, new Date(oldestRead + 1_000).toISOString());
});

test("backfill_channelFetchFailsTransiently_skipsItsReconcileAndAsksForAResync", async () => {
  const { relay, reconciles, logs } = harness({
    pages: {
      [LFP_CHANNEL]: () => {
        throw discordError(500);
      },
    },
  });

  await relay.backfill();

  assert.equal(reconciles().some((op) => op.channelId === LFP_CHANNEL), false);
  assert.equal(reconciles().length, 5);
  assert.equal(relay.needsResync, true);
  assert.equal(logs.includes(`[geti] salon ${LFP_CHANNEL} illisible (500) : rattrapage du salon abandonné`), true);
});

test("backfill_channelWithoutAccess_skipsItWithoutAskingForAResync", async () => {
  const { relay, reconciles } = harness({
    pages: {
      [LFP_CHANNEL]: () => {
        throw discordError(50001);
      },
    },
  });

  await relay.backfill();

  assert.equal(reconciles().length, 5);
  assert.equal(relay.needsResync, false);
});

test("backfill_batchLost_skipsTheReconcileOfThatChannel", async () => {
  const { relay, reconciles } = harness({
    pages: { [LFP_CHANNEL]: () => [message("100000000000000901")] },
    deliver: (op) => (op.kind === "upsert" ? "lost" : "ok"),
  });

  await relay.backfill();

  assert.equal(reconciles().some((op) => op.channelId === LFP_CHANNEL), false);
  assert.equal(relay.needsResync, true);
});

test("backfill_batchRefusedByTheSite_stillReconciles", async () => {
  const { relay, reconcileOf } = harness({
    pages: { [LFP_CHANNEL]: () => [message("100000000000000901")] },
    deliver: (op) => (op.kind === "upsert" ? "refused" : "ok"),
  });

  await relay.backfill();

  assert.deepEqual(reconcileOf(LFP_CHANNEL)?.ids, ["100000000000000901"]);
});

test("backfill_messageDeletedWhileItRuns_isLeftOutOfThePushAndOfTheIds", async () => {
  const holder: { relay: GetiRelay | null } = { relay: null };
  const built = harness({
    pages: {
      [LFP_CHANNEL]: async () => {
        // Supprimé sur Discord entre la lecture de la page et son envoi.
        await holder.relay?.onDelete(LFP_CHANNEL, ["100000000000000901"]);
        return [message("100000000000000902"), message("100000000000000901")];
      },
    },
  });
  holder.relay = built.relay;

  await built.relay.backfill();

  assert.deepEqual(built.upserted(), ["100000000000000902"]);
  assert.deepEqual(built.reconcileOf(LFP_CHANNEL)?.ids, ["100000000000000902"]);
});

test("backfill_messageEditedLiveWhileItRuns_isNotPushedAgainWithTheOlderVersion", async () => {
  const holder: { relay: GetiRelay | null } = { relay: null };
  const built = harness({
    pages: {
      [LFP_CHANNEL]: async () => {
        // Modifié en direct (texte vidé) entre la lecture de la page et son envoi.
        await holder.relay?.onMessage(message("100000000000000901", { content: "", editedTimestamp: NOW - 1_000 }));
        return [message("100000000000000902"), message("100000000000000901")];
      },
    },
  });
  holder.relay = built.relay;

  await built.relay.backfill();

  assert.deepEqual(built.upserted(), ["100000000000000901", "100000000000000902"]);
  assert.deepEqual(built.reconcileOf(LFP_CHANNEL)?.ids, ["100000000000000902", "100000000000000901"]);
});

test("backfill_firstBatchLost_stopsReadingTheOtherChannels", async () => {
  const { relay, fetched } = harness({
    pages: { [LFP_CHANNEL]: () => [message("100000000000000901")] },
    deliver: (op) => (op.kind === "upsert" ? "lost" : "ok"),
  });

  await relay.backfill();

  assert.deepEqual(fetched.map((call) => call.channelId), [LFP_CHANNEL]);
  assert.equal(relay.needsResync, true);
});

test("backfill_reconcileLost_stopsReadingTheOtherChannels", async () => {
  const { relay, fetched } = harness({
    pages: { [LFP_CHANNEL]: () => [message("100000000000000901")] },
    deliver: (op) => (op.kind === "reconcile" ? "lost" : "ok"),
  });

  await relay.backfill();

  assert.deepEqual(fetched.map((call) => call.channelId), [LFP_CHANNEL]);
});

test("backfill_batchLostOnAFullPage_doesNotReadTheNextPage", async () => {
  const page = Array.from({ length: 100 }, (_, index) => message(`1000000000000${String(index + 1000).padStart(5, "0")}`));
  const { relay, fetched } = harness({
    pages: { [LFP_CHANNEL]: () => page },
    deliver: (op) => (op.kind === "upsert" ? "lost" : "ok"),
  });

  await relay.backfill();

  assert.equal(fetched.length, 1);
});

test("backfill_requestedWhileRunning_runsOnceMoreAfterwards", async () => {
  const holder: { relay: GetiRelay | null; asked: boolean } = { relay: null, asked: false };
  const built = harness({
    pages: {
      [LFP_CHANNEL]: () => {
        if (!holder.asked) {
          holder.asked = true;
          void holder.relay?.backfill();
        }
        return [];
      },
    },
  });
  holder.relay = built.relay;

  await built.relay.backfill();

  assert.equal(built.fetched.filter((call) => call.channelId === LFP_CHANNEL).length, 2);
});

test("tick_afterALostSend_runsABackfillAndClearsTheNeed", async () => {
  const { relay, reconciles } = harness();
  relay.noteLost();

  await relay.tick();

  assert.equal(reconciles().length, 6);
  assert.equal(relay.needsResync, false);
});

test("tick_nothingLost_doesNothing", async () => {
  const { relay, fetched } = harness();

  await relay.tick();

  assert.deepEqual(fetched, []);
});

test("noteLost_calledTwice_logsOnce", () => {
  const { relay, logs } = harness();

  relay.noteLost();
  relay.noteLost();

  assert.deepEqual(logs, ["[geti] envoi au site abandonné : rattrapage différé"]);
});
