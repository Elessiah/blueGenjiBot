import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const TMP_DB = path.join(os.tmpdir(), `bgenji-feed-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import { recordEvent, getBacklog, subscribe, type FeedEventRow } from "../../feed/feedBus.js";
import { closeBddInstance } from "../../bdd/Bdd.js";

test("recordEvent insere une ligne et getBacklog la retrouve", async () => {
  await recordEvent(null, "relay", "test relay simple");
  const backlog = await getBacklog(50);
  assert.ok(backlog.length >= 1);
  const last = backlog[backlog.length - 1];
  assert.equal(last.type, "relay");
  assert.equal(last.summary, "test relay simple");
  assert.equal(last.source, null);
  assert.equal(last.target, null);
  assert.ok(typeof last.id === "number" && last.id > 0);
  assert.ok(typeof last.ts === "string" && last.ts.length > 0);
});

test("recordEvent supporte source/target optionnels", async () => {
  await recordEvent(null, "scrim", "scrim test", "GuildA", "user-123");
  const backlog = await getBacklog(50);
  const last = backlog[backlog.length - 1];
  assert.equal(last.type, "scrim");
  assert.equal(last.source, "GuildA");
  assert.equal(last.target, "user-123");
});

test("getBacklog respecte le parametre limit", async () => {
  // Inserer plusieurs events
  for (let i = 0; i < 5; i++) {
    await recordEvent(null, "warn", `warn-${i}`);
  }
  const tail = await getBacklog(3);
  assert.equal(tail.length, 3);
  // ordre ASC : id croissant
  assert.ok(tail[0].id < tail[1].id && tail[1].id < tail[2].id);
});

test("getBacklog avec sinceId ne retourne que les events posterieurs", async () => {
  const before = await getBacklog(50);
  const lastIdBefore = before[before.length - 1].id;
  await recordEvent(null, "auth", "post-marker-1");
  await recordEvent(null, "auth", "post-marker-2");
  const after = await getBacklog(50, lastIdBefore);
  assert.equal(after.length, 2);
  assert.equal(after[0].summary, "post-marker-1");
  assert.equal(after[1].summary, "post-marker-2");
  for (const row of after) {
    assert.ok(row.id > lastIdBefore);
  }
});

test("subscribe recoit les events emis et l'unsubscribe stoppe la reception", async () => {
  const received: FeedEventRow[] = [];
  const unsub = subscribe((ev) => { received.push(ev); });
  await recordEvent(null, "recr", "recrute test sub");
  // Le emit est synchrone dans recordEvent — mais comme recordEvent est async,
  // attendre un microtick suffit pour que le handler ait tourne.
  await new Promise((r) => setImmediate(r));
  assert.ok(received.some((r) => r.summary === "recrute test sub"));
  unsub();
  const beforeCount = received.length;
  await recordEvent(null, "recr", "recrute apres unsub");
  await new Promise((r) => setImmediate(r));
  assert.equal(received.length, beforeCount);
});

test.after(async () => {
  closeBddInstance();
  await new Promise((r) => setTimeout(r, 50));
  try { fs.unlinkSync(TMP_DB); } catch { /* noop */ }
});
