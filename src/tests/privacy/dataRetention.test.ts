import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { Client } from "discord.js";

const TMP_DB = path.join(os.tmpdir(), `bgenji-retention-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";
import {
  ACTIVITY_AUTHOR_RETENTION_DAYS,
  anonymizeOldActivity,
  forgetDepartedGuilds,
} from "../../privacy/dataRetention.js";
import { formatPlayerStats } from "../../commandsHandlers/statsPlayer.js";

const logs: string[] = [];

/** Client minimal : `sendLog` écrit au propriétaire et au salon d'administration. */
function fakeClient(joinedGuildIds: string[]): Client {
  return {
    guilds: { cache: new Map(joinedGuildIds.map((id) => [id, { id }])) },
    users: { fetch: async () => ({ send: async (msg: string) => { logs.push(msg); return { id: "m1" }; } }) },
    channels: { fetch: async () => ({ send: async (msg: string) => { logs.push(msg); return { id: "m2" }; } }) },
  } as unknown as Client;
}

async function count(sql: string, values: unknown[] = []): Promise<number> {
  const bdd = await getBddInstance();
  const rows = await bdd.raw<{ n: number }>(sql, values);
  return Number(rows[0].n);
}

async function seedGuild(guildId: string, channelId: string): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO ChannelPartner (id_channel, id_guild) VALUES (?, ?)", [channelId, guildId]);
  await bdd.raw("INSERT INTO ChannelPartnerRank (id_channel, id_rank) VALUES (?, 1)", [channelId]);
  await bdd.raw("INSERT INTO RefereeRole (id_guild, id_role, set_by) VALUES (?, 'role-ref', 'admin-1')", [guildId]);
}

test("la table UserLink n'existe plus", async () => {
  assert.equal(
    await count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'UserLink'"),
    0,
  );
});

test("l'auteur d'un scrim ou d'une recherche est effacé au-delà de 30 jours, la ligne reste", async () => {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO Scrim (id_author, game, level, id_guild, date) VALUES ('u-old', 'MR', '3', 'g1', DATETIME('now', '-31 days'))");
  await bdd.raw("INSERT INTO Scrim (id_author, game, level, id_guild, date) VALUES ('u-new', 'MR', '3', 'g1', DATETIME('now', '-29 days'))");
  await bdd.raw("INSERT INTO Recrute (id_author, role, id_guild, date) VALUES ('u-old', 'TANK', 'g1', DATETIME('now', '-40 days'))");

  const anonymized = await anonymizeOldActivity(fakeClient(["g1"]));
  assert.equal(anonymized, 2);
  assert.equal(await count("SELECT COUNT(*) AS n FROM Scrim WHERE id_author = 'u-old'"), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM Recrute WHERE id_author = 'u-old'"), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM Scrim WHERE id_author = 'u-new'"), 1);
  // Les compteurs par serveur ne perdent rien.
  assert.equal(await count("SELECT COUNT(*) AS n FROM Scrim WHERE id_guild = 'g1'"), 2);
  assert.equal(await count("SELECT COUNT(*) AS n FROM Recrute WHERE id_guild = 'g1'"), 1);
  // Idempotent : une ligne déjà anonymisée n'est pas recomptée.
  assert.equal(await anonymizeOldActivity(fakeClient(["g1"])), 0);
});

test("la fenêtre d'anonymisation est celle de /stats", () => {
  assert.equal(ACTIVITY_AUTHOR_RETENTION_DAYS, 30);
  const message = formatPlayerStats({ messages: 4, scrims: 2, recherches: 1 });
  assert.match(message, /Messages partenaires \(7 derniers jours\) : 4/);
  assert.match(message, /Scrims proposes \(30 derniers jours\) : 2/);
  assert.match(message, /Recherches \(30 derniers jours\) : 1/);
  assert.doesNotMatch(message, /30j/);
});

test("un serveur quitté pendant l'arrêt est oublié au démarrage, les autres restent", async () => {
  await seedGuild("g-gone", "c-gone");
  await seedGuild("g-stay", "c-stay");
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO ServerModule (id_guild, module_key, enabled) VALUES ('g-orphan', 'scrims', 0)");

  logs.length = 0;
  const forgotten = await forgetDepartedGuilds(fakeClient(["g-stay"]));
  assert.deepEqual([...forgotten].sort(), ["g-gone", "g-orphan"]);
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartner WHERE id_guild = 'g-gone'"), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartnerRank WHERE id_channel = 'c-gone'"), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM RefereeRole WHERE id_guild = 'g-gone'"), 0);
  // Reste d'un `forgetGuild` partiel : une seule table encore peuplée.
  assert.equal(await count("SELECT COUNT(*) AS n FROM ServerModule WHERE id_guild = 'g-orphan'"), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartner WHERE id_guild = 'g-stay'"), 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM RefereeRole WHERE id_guild = 'g-stay'"), 1);
  assert.ok(logs.some((line) => line.includes("2 serveur(s)")));
});

test("un cache de serveurs vide n'efface rien", async () => {
  assert.deepEqual(await forgetDepartedGuilds(fakeClient([])), []);
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartner WHERE id_guild = 'g-stay'"), 1);
});

test.after(async () => {
  await closeBddInstance();
  fs.rmSync(TMP_DB, { force: true });
});
