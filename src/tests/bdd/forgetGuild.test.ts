import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { Client } from "discord.js";

const TMP_DB = path.join(os.tmpdir(), `bgenji-forget-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";
import { _resetServer } from "../../commandsHandlers/services/resetServer.js";

/** Client minimal : `_resetServer` relit le nom du serveur, `sendLog` écrit au propriétaire et au salon d'administration. */
const fakeClient = {
  guilds: { fetch: async () => ({ name: "Serveur test" }) },
  users: { fetch: async () => ({ send: async () => ({ id: "m1" }) }) },
  channels: { fetch: async () => ({ send: async () => ({ id: "m2" }) }) },
} as unknown as Client;

async function seedGuild(guildId: string, channelId: string): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT INTO ChannelPartner (id_channel, id_guild) VALUES (?, ?)", [channelId, guildId]);
  await bdd.raw("INSERT INTO ChannelPartnerRank (id_channel, id_rank) VALUES (?, 1)", [channelId]);
  await bdd.setServerInvite(guildId, "https://discord.gg/abc", "admin-1");
  await bdd.raw("INSERT INTO RefereeRole (id_guild, id_role, set_by) VALUES (?, 'role-ref', 'admin-1')", [guildId]);
  await bdd.raw("INSERT INTO RoleAdmin (guild_id, role_id) VALUES (?, 'role-admin')", [guildId]);
  await bdd.raw("INSERT INTO ServerModule (id_guild, module_key, enabled) VALUES (?, 'scrim', 1)", [guildId]);
  await bdd.raw(
    "INSERT INTO AdhesionInterval (message, guild_id, author_id, interval_days) VALUES ('rappel', ?, 'admin-1', 30)",
    [guildId],
  );
}

async function count(table: string, column: string, value: string): Promise<number> {
  const bdd = await getBddInstance();
  const rows = await bdd.raw<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`, [value]);
  return Number(rows[0].n);
}

test("forgetGuild efface toute la configuration du serveur quitté", async () => {
  await seedGuild("guild-gone", "chan-gone");
  const bdd = await getBddInstance();
  const removed = await bdd.forgetGuild("guild-gone");
  assert.deepEqual(removed, {
    ServerInvite: 1,
    RefereeRole: 1,
    RoleAdmin: 1,
    ServerModule: 1,
    AdhesionInterval: 1,
  });
  assert.equal(await count("ServerInvite", "id_guild", "guild-gone"), 0);
  assert.equal(await count("RefereeRole", "id_guild", "guild-gone"), 0);
  assert.equal(await count("RoleAdmin", "guild_id", "guild-gone"), 0);
  assert.equal(await count("ServerModule", "id_guild", "guild-gone"), 0);
  assert.equal(await count("AdhesionInterval", "guild_id", "guild-gone"), 0);
  // Les salons relayés et leurs filtres de rang restent l'affaire de `deleteGuildChannels`.
  assert.equal(await count("ChannelPartner", "id_guild", "guild-gone"), 1);
  assert.equal(await count("ChannelPartnerRank", "id_channel", "chan-gone"), 1);
});

test("forgetGuild ne touche pas aux autres serveurs", async () => {
  await seedGuild("guild-stay", "chan-stay");
  const bdd = await getBddInstance();
  await bdd.forgetGuild("guild-other");
  assert.equal(await count("ChannelPartnerRank", "id_channel", "chan-stay"), 1);
  assert.equal(await count("ServerInvite", "id_guild", "guild-stay"), 1);
  assert.equal(await count("RefereeRole", "id_guild", "guild-stay"), 1);
  assert.equal(await count("RoleAdmin", "guild_id", "guild-stay"), 1);
  assert.equal(await count("ServerModule", "id_guild", "guild-stay"), 1);
  assert.equal(await count("AdhesionInterval", "guild_id", "guild-stay"), 1);
});

test("forgetGuild est idempotent : un second passage n'efface rien", async () => {
  const bdd = await getBddInstance();
  const removed = await bdd.forgetGuild("guild-gone");
  assert.ok(Object.values(removed).every((n) => n === 0));
});

test("_resetServer vide aussi les filtres de rang de ses salons", async () => {
  await seedGuild("guild-reset", "chan-reset");
  const status = await _resetServer(fakeClient, "guild-reset");
  assert.equal(status.success, true);
  assert.equal(await count("ChannelPartner", "id_guild", "guild-reset"), 0);
  assert.equal(await count("ChannelPartnerRank", "id_channel", "chan-reset"), 0);
  // La commande /reset-server ne retire que le relais, pas la configuration.
  assert.equal(await count("ServerInvite", "id_guild", "guild-reset"), 1);
});

test.after(async () => {
  await closeBddInstance();
  if (fs.existsSync(TMP_DB)) {
    fs.unlinkSync(TMP_DB);
  }
});
