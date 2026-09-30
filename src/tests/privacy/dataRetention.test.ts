import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { Client } from "discord.js";

const TMP_DB = path.join(os.tmpdir(), `bgenji-retention-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import { getBddInstance, closeBddInstance, resetBddInstance } from "../../bdd/Bdd.js";
import {
  ACTIVITY_AUTHOR_RETENTION_DAYS,
  anonymizeOldActivity,
  eraseGuild,
  forgetDepartedGuilds,
  runDataRetention,
} from "../../privacy/dataRetention.js";
import { formatPlayerStats } from "../../commandsHandlers/statsPlayer.js";
import { _resetServer } from "../../commandsHandlers/services/resetServer.js";

const logs: string[] = [];

/** Client minimal : `sendLog` écrit au propriétaire et au salon d'administration. */
function fakeClient(joinedGuildIds: string[], applicationId = "app-prod"): Client {
  return {
    user: { id: applicationId },
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

test("une table UserLink existante est supprimée à l'ouverture de la base", async () => {
  // Base d'avant le retrait de `/link` : la table existe et porte des lignes.
  const before = await getBddInstance();
  await before.raw("CREATE TABLE IF NOT EXISTS UserLink (id_user TEXT PRIMARY KEY, code TEXT NOT NULL, expires_at DATETIME NOT NULL, linked_at DATETIME)");
  await before.raw("INSERT INTO UserLink (id_user, code, expires_at) VALUES ('u1', '123456', DATETIME('now'))");
  // Préférence du module `oauth`, retiré avec `/link`.
  await before.raw("INSERT INTO ServerModule (id_guild, module_key, enabled) VALUES ('g-oauth', 'oauth', 1)");
  assert.equal(
    await count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'UserLink'"),
    1,
  );
  await resetBddInstance();
  assert.equal(
    await count("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'UserLink'"),
    0,
  );
  assert.equal(await count("SELECT COUNT(*) AS n FROM ServerModule WHERE module_key = 'oauth'"), 0);
});

test("deleteGuildChannels continue après un salon en échec et nomme l'échec", async () => {
  await seedGuild("g-chan", "c-chan-1");
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO ChannelPartner (id_channel, id_guild) VALUES ('c-chan-2', 'g-chan')");
  const original = bdd.deleteChannelServices;
  bdd.deleteChannelServices = async (id: string) =>
    id === "c-chan-1" ? { success: false, message: "busy c-chan-1" } : original.call(bdd, id);
  let removal;
  try {
    removal = await bdd.deleteGuildChannels("g-chan");
  } finally {
    bdd.deleteChannelServices = original;
  }
  assert.equal(removal.success, false);
  assert.equal(removal.found, 2);
  assert.match(removal.message, /busy c-chan-1/);
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartner WHERE id_channel = 'c-chan-2'"), 0);
  await bdd.forgetGuild("g-chan");
  await bdd.deleteGuildChannels("g-chan");
});

test("_resetServer réussit même quand Discord ne connaît plus le serveur", async () => {
  await seedGuild("g-left", "c-left");
  const client = {
    ...fakeClient(["g-stay"]),
    guilds: { cache: new Map(), fetch: async () => { throw new Error("Unknown Guild"); } },
  } as unknown as Client;
  const ret = await _resetServer(client, "g-left");
  assert.equal(ret.success, true);
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartner WHERE id_guild = 'g-left'"), 0);
  await (await getBddInstance()).forgetGuild("g-left");
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
  assert.ok(logs.some((line) => line.includes("2 serveur(s) que le bot ne rejoint plus")));
});

test("un identifiant de serveur NULL n'est jamais compté comme oublié", async () => {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO RefereeRole (id_guild, id_role, set_by) VALUES (NULL, 'role-x', 'admin-1')");
  assert.equal((await bdd.listConfiguredGuildIds()).includes("null"), false);
  assert.deepEqual(await forgetDepartedGuilds(fakeClient(["g-stay"])), []);
});

test("eraseGuild retire les salons relayés même si l'oubli de la configuration échoue", async () => {
  await seedGuild("g-partial", "c-partial");
  const bdd = await getBddInstance();
  const original = bdd.forgetGuild;
  bdd.forgetGuild = async () => { throw new Error("SQLITE_BUSY"); };
  try {
    await assert.rejects(eraseGuild("g-partial"), /SQLITE_BUSY/);
  } finally {
    bdd.forgetGuild = original;
  }
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartner WHERE id_guild = 'g-partial'"), 0);
  // La configuration restée en place est reprise par le rattrapage suivant.
  assert.equal(await count("SELECT COUNT(*) AS n FROM RefereeRole WHERE id_guild = 'g-partial'"), 1);
  assert.deepEqual(await forgetDepartedGuilds(fakeClient(["g-stay"])), ["g-partial"]);
  assert.equal(await count("SELECT COUNT(*) AS n FROM RefereeRole WHERE id_guild = 'g-partial'"), 0);
});

test("le rattrapage n'efface rien pour une autre application Discord que celle de la base", async () => {
  for (const id of ["g-a", "g-b", "g-c", "g-d"]) {
    await seedGuild(id, `c-${id}`);
  }
  // La base appartient à l'application de production, quel que soit l'ordre des tests.
  assert.equal(await (await getBddInstance()).claimOwnerApplication("app-prod"), true);
  logs.length = 0;
  // Bot de développement lancé sur la base de production : son cache ne la décrit pas.
  assert.deepEqual(await forgetDepartedGuilds(fakeClient(["g-dev"], "app-dev")), []);
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartner WHERE id_guild IN ('g-a', 'g-b', 'g-c', 'g-d', 'g-stay')"), 5);
  assert.ok(logs.some((line) => line.includes("autre application")));
  // L'application propriétaire, elle, rattrape tout l'arriéré d'un coup.
  const forgotten = await forgetDepartedGuilds(fakeClient(["g-stay"]));
  assert.deepEqual([...forgotten].sort(), ["g-a", "g-b", "g-c", "g-d"]);
});

test("runDataRetention ne lève pas quand un ménage échoue, et les suivants passent", async () => {
  await seedGuild("g-after-failure", "c-after-failure");
  const bdd = await getBddInstance();
  const original = bdd.anonymizeActivityAuthors;
  bdd.anonymizeActivityAuthors = async () => { throw new Error("boom"); };
  try {
    await runDataRetention(fakeClient(["g-stay"]));
  } finally {
    bdd.anonymizeActivityAuthors = original;
  }
  // Le rattrapage des serveurs, qui suit l'anonymisation en échec, a bien joué.
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartner WHERE id_guild = 'g-after-failure'"), 0);
  assert.equal(await count("SELECT COUNT(*) AS n FROM RefereeRole WHERE id_guild = 'g-after-failure'"), 0);
});

test("les filtres de rang d'un salon déjà retiré sont purgés", async () => {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO ChannelPartnerRank (id_channel, id_rank) VALUES ('c-orphan', 1)");
  assert.ok((await bdd.purgeOrphanRankFilters()) >= 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartnerRank WHERE id_channel = 'c-orphan'"), 0);
  // Un salon encore relayé garde les siens.
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartnerRank WHERE id_channel = 'c-stay'"), 1);
});

test("un cache de serveurs vide n'efface rien", async () => {
  assert.deepEqual(await forgetDepartedGuilds(fakeClient([])), []);
  assert.equal(await count("SELECT COUNT(*) AS n FROM ChannelPartner WHERE id_guild = 'g-stay'"), 1);
});

test.after(async () => {
  await closeBddInstance();
  fs.rmSync(TMP_DB, { force: true });
});
