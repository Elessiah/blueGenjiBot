import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Base jetable désignée avant l'import : le singleton l'ouvre à son premier appel.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-reset-channel-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, resetBddInstance } from "../../bdd/Bdd.js";
import { _resetChannel } from "../../commandsHandlers/services/resetChannel.js";
import type { Client } from "discord.js";

/**
 * Caractérisation de `_resetChannel` : réponse rendue, lectures Discord,
 * lignes du journal et nombre d'essais, pour chaque issue de la suppression.
 */

type ChannelLookup = "found" | "null" | "throws";

function fakeClient(trace: string[], lookup: ChannelLookup = "found"): Client {
  return {
    users: { fetch: async (id: string) => ({ id, send: async () => ({ id: "dm" }) }) },
    channels: {
      fetch: async (id: string) => {
        if (id === process.env.INFO_SERV) {
          return { send: async (text: string) => { trace.push("log " + text); return { id: "log" }; } };
        }
        trace.push("channels.fetch " + id);
        if (lookup === "throws") throw new Error("Unknown Channel");
        return lookup === "null" ? null : { id, guild: { name: "Serveur relayé" } };
      },
    },
  } as unknown as Client;
}

async function relay(channelId: string): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO ChannelPartner (id_channel, id_guild, region) VALUES (?, 'g1', 0)", [channelId]);
  await bdd.raw("INSERT INTO ChannelPartnerService (id_channel, id_service) VALUES (?, 1)", [channelId]);
}

async function stillRelayed(channelId: string): Promise<boolean> {
  const bdd = await getBddInstance();
  return (await bdd.raw("SELECT 1 FROM ChannelPartner WHERE id_channel = ?", [channelId])).length > 0;
}

test("salon jamais relayé : rien au journal, ses filtres de rang retirés", async () => {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO ChannelPartnerRank (id_channel, id_rank) VALUES ('c-never', 1)", []);
  const trace: string[] = [];
  assert.deepEqual(await _resetChannel(fakeClient(trace), "c-never"), { success: true, message: "Ce salon n'est pas relayé." });
  assert.deepEqual(trace, []);
  assert.equal((await bdd.raw("SELECT 1 FROM ChannelPartnerRank WHERE id_channel = 'c-never'")).length, 0);
});

test("nom du serveur fourni : aucune relecture du salon", async () => {
  await relay("c-1");
  const trace: string[] = [];
  assert.deepEqual(await _resetChannel(fakeClient(trace), "c-1", "Serveur connu"), { success: true, message: "Channel reseted" });
  assert.deepEqual(trace, ["log A service has been unlinked from a channel of Serveur connu."]);
  assert.equal(await stillRelayed("c-1"), false);
});

test("sans nom : relu chez Discord, ou désigné par son identifiant", async () => {
  const cases: Array<[ChannelLookup, string]> = [
    ["found", "Serveur relayé"],
    ["null", "channel c-2"],
    ["throws", "channel c-2"],
  ];
  for (const [lookup, where] of cases) {
    await relay("c-2");
    const trace: string[] = [];
    assert.deepEqual(await _resetChannel(fakeClient(trace, lookup), "c-2"), { success: true, message: "Channel reseted" });
    assert.deepEqual(trace, ["channels.fetch c-2", `log A service has been unlinked from a channel of ${where}.`]);
  }
});

test("suppression rendue en échec : dix essais, puis le dernier motif", async (t) => {
  await relay("c-3");
  const bdd = await getBddInstance();
  let calls = 0;
  t.mock.method(bdd, "deleteChannel", async () => ({ success: false, message: "base occupée " + ++calls }));
  const trace: string[] = [];
  assert.deepEqual(await _resetChannel(fakeClient(trace), "c-3"), { success: false, message: "base occupée 10\n Please contact elessiah" });
  assert.equal(calls, 10);
  assert.deepEqual(trace, []);
});

test("lecture qui lève : dix essais, puis le dernier message", async (t) => {
  const bdd = await getBddInstance();
  let calls = 0;
  t.mock.method(bdd, "get", async () => { throw new Error("SQLITE_BUSY " + ++calls); });
  const trace: string[] = [];
  assert.deepEqual(await _resetChannel(fakeClient(trace), "c-4"), { success: false, message: "SQLITE_BUSY 10\n Please contact elessiah" });
  assert.equal(calls, 10);
});

test("échecs passagers puis réussite : un seul avis au journal", async (t) => {
  await relay("c-5");
  const bdd = await getBddInstance();
  const real = bdd.deleteChannel.bind(bdd);
  let calls = 0;
  t.mock.method(bdd, "deleteChannel", async (id: string) => (++calls < 3 ? { success: false, message: "occupée" } : real(id)));
  const trace: string[] = [];
  assert.deepEqual(await _resetChannel(fakeClient(trace), "c-5", "S"), { success: true, message: "Channel reseted" });
  assert.equal(calls, 3);
  assert.deepEqual(trace, ["log A service has been unlinked from a channel of S."]);
});

test("ferme la base à la fin de la suite", async () => {
  assert.equal(await resetBddInstance(), true);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
