import test from "node:test";
import assert from "node:assert/strict";

import { toGetiWirePost } from "../../geti/getiPayload.js";
import { GetiQueue } from "../../geti/getiQueue.js";
import type { GetiSiteOp, GetiSiteOutcome } from "../../geti/getiSiteClient.js";

// File des envois GETI : ordre, reprises bornées, abandon signalé, suppression qui retire une annonce en attente.

const DELAYS = [10, 20];

function upsert(...ids: string[]): GetiSiteOp {
  return {
    kind: "upsert",
    posts: ids.map((id) =>
      toGetiWirePost({ id, channelId: "679323773559635999", content: "LFT", createdTimestamp: Date.parse("2026-11-27T10:00:00.000Z") }),
    ),
  };
}

function remove(...ids: string[]): GetiSiteOp {
  return { kind: "delete", ids };
}

/** File dont le site rend les issues données, dans l'ordre (puis `ok`). */
function harness(outcomes: GetiSiteOutcome[] = [], maxSize?: number) {
  const sent: GetiSiteOp[] = [];
  const slept: number[] = [];
  let lost = 0;
  const queue = new GetiQueue({
    send: async (op) => {
      sent.push(structuredClone(op));
      return outcomes.shift() ?? "ok";
    },
    onLost: () => { lost += 1; },
    sleep: async (ms) => { slept.push(ms); },
    retryDelaysMs: DELAYS,
    maxSize,
  });
  return { queue, sent, slept, lostCount: () => lost };
}

/** Site dont le premier appel reste en attente jusqu'à `release()`. */
function gatedHarness(maxSize?: number) {
  const sent: GetiSiteOp[] = [];
  let lost = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let first = true;
  const queue = new GetiQueue({
    send: async (op) => {
      sent.push(structuredClone(op));
      if (first) {
        first = false;
        await gate;
      }
      return "ok";
    },
    onLost: () => { lost += 1; },
    sleep: async () => undefined,
    retryDelaysMs: DELAYS,
    maxSize,
  });
  return { queue, sent, release: () => { release(); }, lostCount: () => lost };
}

test("enqueue_siteAnswers_resolvesOk", async () => {
  const { queue, sent, lostCount } = harness();

  const delivery = await queue.enqueue(remove("100000000000000901"));

  assert.equal(delivery, "ok");
  assert.deepEqual(sent, [remove("100000000000000901")]);
  assert.equal(lostCount(), 0);
});

test("enqueue_twoOperations_areSentInOrder", async () => {
  const { queue, sent } = harness();

  await Promise.all([queue.enqueue(upsert("100000000000000901")), queue.enqueue(remove("100000000000000902"))]);

  assert.deepEqual(sent.map((op) => op.kind), ["upsert", "delete"]);
});

test("enqueue_secondOperationWhileFirstInFlight_waitsForIt", async () => {
  const { queue, sent, release } = gatedHarness();
  const first = queue.enqueue(remove("100000000000000901"));
  const second = queue.enqueue(remove("100000000000000902"));
  await Promise.resolve();

  assert.equal(sent.length, 1);
  release();
  await Promise.all([first, second]);
  assert.equal(sent.length, 2);
});

test("enqueue_retryThenOk_waitsTheFirstDelayAndDelivers", async () => {
  const { queue, slept, lostCount } = harness(["retry", "ok"]);

  const delivery = await queue.enqueue(remove("100000000000000901"));

  assert.equal(delivery, "ok");
  assert.deepEqual(slept, [10]);
  assert.equal(lostCount(), 0);
});

test("enqueue_retriesExhausted_resolvesLostAndSignalsIt", async () => {
  const { queue, sent, slept, lostCount } = harness(["retry", "retry", "retry"]);

  const delivery = await queue.enqueue(remove("100000000000000901"));

  assert.equal(delivery, "lost");
  assert.equal(sent.length, 3);
  assert.deepEqual(slept, [10, 20]);
  assert.equal(lostCount(), 1);
});

test("enqueue_afterALoss_nextOperationGetsASingleAttempt", async () => {
  const { queue, sent } = harness(["retry", "retry", "retry", "retry"]);
  await queue.enqueue(remove("100000000000000901"));

  const delivery = await queue.enqueue(remove("100000000000000902"));

  assert.equal(delivery, "lost");
  assert.equal(sent.length, 4);
});

test("enqueue_successAfterALoss_restoresTheRetries", async () => {
  const { queue, slept } = harness(["retry", "retry", "retry", "ok", "retry", "ok"]);
  await queue.enqueue(remove("100000000000000901"));
  await queue.enqueue(remove("100000000000000902"));

  const delivery = await queue.enqueue(remove("100000000000000903"));

  assert.equal(delivery, "ok");
  assert.deepEqual(slept, [10, 20, 10]);
});

test("enqueue_siteRefusesTheBody_resolvesRefusedWithoutSignallingALoss", async () => {
  const { queue, sent, lostCount } = harness(["drop"]);

  const delivery = await queue.enqueue(remove("100000000000000901"));

  assert.equal(delivery, "refused");
  assert.equal(sent.length, 1);
  assert.equal(lostCount(), 0);
});

test("enqueue_sendThrows_isRetriedLikeASilentSite", async () => {
  let calls = 0;
  const queue = new GetiQueue({
    send: async () => {
      calls += 1;
      if (calls === 1) { throw new Error("boom"); }
      return "ok";
    },
    onLost: () => undefined,
    sleep: async () => undefined,
    retryDelaysMs: DELAYS,
  });

  const delivery = await queue.enqueue(remove("100000000000000901"));

  assert.equal(delivery, "ok");
  assert.equal(calls, 2);
});

test("enqueue_queueFull_resolvesLostAtOnce", async () => {
  const { queue, release, lostCount } = gatedHarness(1);
  const inFlight = queue.enqueue(remove("100000000000000901"));
  const waiting = queue.enqueue(remove("100000000000000902"));

  const overflow = await queue.enqueue(remove("100000000000000903"));

  assert.equal(overflow, "lost");
  assert.equal(lostCount(), 1);
  release();
  assert.deepEqual(await Promise.all([inFlight, waiting]), ["ok", "ok"]);
});

test("enqueue_deleteWhileUpsertWaits_removesThePostFromTheWaitingBatch", async () => {
  const { queue, sent, release } = gatedHarness();
  const inFlight = queue.enqueue(remove("100000000000000900"));
  const batch = queue.enqueue(upsert("100000000000000901", "100000000000000902"));
  const deletion = queue.enqueue(remove("100000000000000901"));
  release();
  await Promise.all([inFlight, batch, deletion]);

  assert.deepEqual(sent[1].kind === "upsert" ? sent[1].posts.map((post) => post.id) : null, ["100000000000000902"]);
});

test("enqueue_deleteEmptiesAWaitingBatch_batchIsNotSent", async () => {
  const { queue, sent, release } = gatedHarness();
  const inFlight = queue.enqueue(remove("100000000000000900"));
  const batch = queue.enqueue(upsert("100000000000000901"));
  const deletion = queue.enqueue(remove("100000000000000901"));
  release();

  assert.deepEqual(await Promise.all([inFlight, batch, deletion]), ["ok", "ok", "ok"]);
  assert.deepEqual(sent.map((op) => op.kind), ["delete", "delete"]);
});

test("size_operationsWaiting_countsThemWithoutTheOneInFlight", async () => {
  const { queue, release } = gatedHarness();
  const inFlight = queue.enqueue(remove("100000000000000901"));
  const waiting = queue.enqueue(remove("100000000000000902"));

  assert.equal(queue.size, 1);
  release();
  await Promise.all([inFlight, waiting]);
  assert.equal(queue.size, 0);
});
