import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { Client } from "discord.js";

const TMP_DB = path.join(os.tmpdir(), `bgenji-snap-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import { recordDailySnapshot, getSnapshotsBetween } from "../../snapshots/dailySnapshot.js";
import { closeBddInstance, getBddInstance } from "../../bdd/Bdd.js";

// Fake Client minimal: seul client.guilds.cache.size est lu par recordDailySnapshot.
const fakeClient = (size: number): Client => ({ guilds: { cache: { size } } } as unknown as Client);

test("recordDailySnapshot insere une ligne pour aujourd'hui", async () => {
  await recordDailySnapshot(fakeClient(7));
  const today = new Date().toISOString().slice(0, 10);
  const rows = await getSnapshotsBetween(1, 0);
  const todayRow = rows.find((r) => r.date === today);
  assert.ok(todayRow, "snapshot du jour doit exister");
  assert.equal(todayRow!.servers_count, 7);
  assert.equal(todayRow!.channels_count, 0); // aucune ChannelPartner inseree
});

test("recordDailySnapshot fait un upsert (idempotent sur la meme date)", async () => {
  await recordDailySnapshot(fakeClient(7));
  await recordDailySnapshot(fakeClient(42));
  const today = new Date().toISOString().slice(0, 10);
  const rows = await getSnapshotsBetween(1, 0);
  const todayRows = rows.filter((r) => r.date === today);
  assert.equal(todayRows.length, 1, "une seule ligne pour aujourd'hui");
  assert.equal(todayRows[0].servers_count, 42, "upsert remplace la valeur");
});

test("recordDailySnapshot prend en compte les messages/relais sur -1 jour", async () => {
  // Inserer des donnees synthetiques
  const bdd = await getBddInstance();
  await bdd.set("OGMsg", ["id_msg", "id_author"], ["snap-msg-1", "user-A"]);
  await bdd.set("OGMsg", ["id_msg", "id_author"], ["snap-msg-2", "user-B"]);
  await bdd.set("ChannelPartner", ["id_channel", "id_guild", "region"], ["snap-ch-1", "snap-guild-1", 0]);
  await bdd.set("DPMsg", ["id_msg", "id_channel", "id_og"], ["snap-dp-1", "snap-ch-1", "snap-msg-1"]);

  await recordDailySnapshot(fakeClient(3));
  const today = new Date().toISOString().slice(0, 10);
  const rows = await getSnapshotsBetween(1, 0);
  const row = rows.find((r) => r.date === today)!;
  assert.ok(row.messages_count >= 2);
  assert.ok(row.relays_count >= 1);
  assert.equal(row.channels_count, 1);
});

test("getSnapshotsBetween retourne un tableau (vide si pas de match)", async () => {
  const veryOld = await getSnapshotsBetween(3650, 3640); // 10 ans en arriere
  assert.equal(Array.isArray(veryOld), true);
  assert.equal(veryOld.length, 0);
});

test.after(async () => {
  closeBddInstance();
  await new Promise((r) => setTimeout(r, 50));
  try { fs.unlinkSync(TMP_DB); } catch { /* noop */ }
});
