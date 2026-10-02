import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

/**
 * Couche de données `Bdd` sur une base SQLite jetable : cycle de vie du
 * singleton, écritures génériques, salons partenaires, rôle arbitre, et
 * chemins d'échec (transaction annulée, table absente, base fermée).
 */

const TMP_DIR = path.join(os.tmpdir(), `bgenji-bdd-methods-${randomUUID()}`);
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "singleton.sqlite");

import { Bdd, closeBddInstance, getBddInstance, resetBddInstance, resolveBddPath } from "../../bdd/Bdd.js";

/** Base dédiée à un test, fermée à sa fin (sous Windows un fichier ouvert bloque le nettoyage). */
async function freshBdd(t: test.TestContext): Promise<Bdd> {
  t.mock.method(console, "log", () => {});
  const bdd = await Bdd.create(path.join(TMP_DIR, `${randomUUID()}.sqlite`));
  t.mock.restoreAll();
  t.after(() => bdd.close());
  return bdd;
}

async function count(bdd: Bdd, query: string, values: unknown[] = []): Promise<number> {
  const [row] = await bdd.raw<{ n: number }>(query, values);
  return Number(row.n);
}

test.after(async () => {
  await resetBddInstance();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

// --- Singleton ----------------------------------------------------------------

test("fermer ou réinitialiser sans instance ouverte rend false", async () => {
  assert.equal(await closeBddInstance(), false);
  assert.equal(await resetBddInstance(), false);
});

test("resolveBddPath : BDD_PATH absolu, sinon repli sur ./data/database.sqlite", (t) => {
  const previous = process.env.BDD_PATH;
  t.after(() => { process.env.BDD_PATH = previous; });
  process.env.BDD_PATH = "  relatif/base.sqlite  ";
  assert.equal(resolveBddPath(), path.resolve("relatif/base.sqlite"));
  process.env.BDD_PATH = "   ";
  assert.equal(resolveBddPath(), path.resolve("./data/database.sqlite"));
  delete process.env.BDD_PATH;
  assert.equal(resolveBddPath(), path.resolve("./data/database.sqlite"));
});

test("getBddInstance rend le même objet ; closeBddInstance le garde fermé, resetBddInstance l'oublie", async (t) => {
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", () => {});
  const first = await getBddInstance();
  assert.equal(await getBddInstance(), first);

  assert.equal(await closeBddInstance(), true);
  assert.equal(await getBddInstance(), first, "l'instance fermée reste en place");
  assert.deepEqual(await first.raw("SELECT 1 AS x"), [], "une base fermée ne lit plus rien");

  assert.equal(await resetBddInstance(), true);
  const second = await getBddInstance();
  assert.notEqual(second, first);
  assert.deepEqual(await second.raw<{ x: number }>("SELECT 1 AS x"), [{ x: 1 }]);
});

test("delete() ferme la connexion sans attendre", async (t) => {
  const bdd = await freshBdd(t);
  bdd.delete();
  assert.deepEqual(await bdd.raw("SELECT 1"), []);
});

test("backupTo écrase une copie existante par un instantané lisible", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.set("ServerInvite", ["id_guild", "invite_url"], ["g1", "https://discord.gg/a"]);
  const dest = path.join(TMP_DIR, `backup-${randomUUID()}.sqlite`);
  fs.writeFileSync(dest, "ancienne copie");
  await bdd.backupTo(dest);
  const copy = await Bdd.create(dest);
  try {
    assert.equal(await copy.getServerInvite("g1"), "https://discord.gg/a");
  } finally {
    await copy.close();
  }
});

// --- Écritures génériques -----------------------------------------------------

test("set : colonnes et valeurs de longueurs différentes refusées sans écrire", async (t) => {
  const bdd = await freshBdd(t);
  const status = await bdd.set("ServerInvite", ["id_guild", "invite_url"], ["g1"]);
  assert.deepEqual(status, { success: false, message: "ElemName and value must be the same length." });
  assert.equal(await count(bdd, "SELECT COUNT(*) AS n FROM ServerInvite"), 0);
});

test("set : une contrainte violée rend un statut d'échec nommant la table", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.set("ServerInvite", ["id_guild", "invite_url"], ["g1", "a"]);
  const status = await bdd.set("ServerInvite", ["id_guild", "invite_url"], ["g1", "b"]);
  assert.equal(status.success, false);
  assert.match(status.message, /^Error while adding "ServerInvite": .*UNIQUE/);
});

test("set : null et undefined deviennent NULL, les autres valeurs restent liées", async (t) => {
  const bdd = await freshBdd(t);
  const status = await bdd.set("ServerInvite", ["id_guild", "invite_url", "set_by"], ["g1", "https://x", null]);
  assert.equal(status.success, true);
  const [row] = await bdd.raw<{ set_by: string | null }>("SELECT set_by FROM ServerInvite WHERE id_guild = 'g1'");
  assert.equal(row.set_by, null);
});

test("get : tri ascendant, descendant, ou aucun quand le sens n'est pas donné", async (t) => {
  const bdd = await freshBdd(t);
  for (const id of ["b", "a", "c"]) {
    await bdd.set("ServerInvite", ["id_guild", "invite_url"], [id, "u"]);
  }
  const ids = async (asc?: boolean) =>
    ((await bdd.get("ServerInvite", ["id_guild"], {}, undefined, asc, "id_guild")) as { id_guild: string }[]).map((r) => r.id_guild);
  assert.deepEqual(await ids(true), ["a", "b", "c"]);
  assert.deepEqual(await ids(false), ["c", "b", "a"]);
  assert.deepEqual((await ids(undefined)).sort(), ["a", "b", "c"]);
});

test("queryBuilder : jointures puis clause WHERE et valeurs liées", async (t) => {
  const bdd = await freshBdd(t);
  const query = await bdd.queryBuilder(
    "SELECT * FROM ChannelPartner",
    { ChannelPartnerService: "ChannelPartner.id_channel = ChannelPartnerService.id_channel" },
    { query: "id_guild = ?", values: ["g1"] },
  );
  assert.equal(query.query, "SELECT * FROM ChannelPartner JOIN ChannelPartnerService ON ChannelPartner.id_channel = ChannelPartnerService.id_channel WHERE id_guild = ?");
  assert.deepEqual(query.ret_array, ["g1"]);
});

// --- Salons partenaires -------------------------------------------------------

test("setNewPartnerChannel : crée le salon, lie le service, refuse le doublon", async (t) => {
  const bdd = await freshBdd(t);
  assert.deepEqual(await bdd.setNewPartnerChannel("chan-1", "g1", "lfs", 2), { success: true, message: "AllWentFine" });
  assert.deepEqual(await bdd.raw("SELECT id_channel, id_guild, region FROM ChannelPartner"), [{ id_channel: "chan-1", id_guild: "g1", region: 2 }]);

  // Un second service sur le même salon : pas de nouvelle ligne ChannelPartner.
  assert.equal((await bdd.setNewPartnerChannel("chan-1", "g1", "lft", 2)).success, true);
  assert.equal(await count(bdd, "SELECT COUNT(*) AS n FROM ChannelPartner"), 1);
  assert.equal(await count(bdd, "SELECT COUNT(*) AS n FROM ChannelPartnerService WHERE id_channel = 'chan-1'"), 2);

  assert.deepEqual(await bdd.setNewPartnerChannel("chan-1", "g1", "lfs", 2), { success: false, message: 'Channel is already linked to "lfs".' });
});

test("setNewPartnerChannel : région hors bornes refusée par la contrainte", async (t) => {
  const bdd = await freshBdd(t);
  const status = await bdd.setNewPartnerChannel("chan-1", "g1", "lfs", 9);
  assert.equal(status.success, false);
  assert.match(status.message, /CHECK constraint/);
  assert.equal(await count(bdd, "SELECT COUNT(*) AS n FROM ChannelPartner"), 0);
});

test("setNewPartnerChannel : service inconnu, statut d'échec sans lien orphelin", async (t) => {
  const bdd = await freshBdd(t);
  const status = await bdd.setNewPartnerChannel("chan-1", "g1", "service-inconnu", 0);
  assert.equal(status.success, false);
  assert.match(status.message, /^I have encountered an error/);
  assert.equal(await count(bdd, "SELECT COUNT(*) AS n FROM ChannelPartnerService"), 0);
});

test("deleteChannelServices retire le salon et ses services, et seulement lui", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.setNewPartnerChannel("chan-1", "g1", "lfs", 0);
  await bdd.setNewPartnerChannel("chan-2", "g1", "lfs", 0);
  assert.deepEqual(await bdd.deleteChannelServices("chan-1"), { success: true, message: "Services deleted." });
  assert.deepEqual(await bdd.raw("SELECT id_channel FROM ChannelPartner"), [{ id_channel: "chan-2" }]);
  assert.deepEqual(await bdd.raw("SELECT id_channel FROM ChannelPartnerService"), [{ id_channel: "chan-2" }]);
});

test("deleteChannelServices : base fermée, statut d'échec au lieu d'une exception", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.close();
  t.mock.method(console, "error", () => {});
  assert.deepEqual(await bdd.deleteChannelServices("chan-1"), { success: false, message: "Failed to delete channel services." });
});

test("deleteChannel : filtres de rang illisibles, échec nommé sans toucher au salon", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.setNewPartnerChannel("chan-1", "g1", "lfs", 0);
  await bdd.raw("DROP TABLE ChannelPartnerRank");
  const status = await bdd.deleteChannel("chan-1");
  assert.equal(status.success, false);
  assert.match(status.message, /^Échec du retrait des filtres de rang : .*ChannelPartnerRank/);
  assert.equal(await count(bdd, "SELECT COUNT(*) AS n FROM ChannelPartner"), 1);
});

test("partnerHasRanks : aucun rang demandé vaut oui, sinon il faut un filtre correspondant", async (t) => {
  const bdd = await freshBdd(t);
  assert.equal(await bdd.partnerHasRanks("chan-1", []), true);
  assert.equal(await bdd.partnerHasRanks("chan-1", ["gold"]), false);
  await bdd.raw("INSERT INTO ChannelPartnerRank (id_channel, id_rank) SELECT 'chan-1', id_rank FROM Ranks WHERE name = 'gold'");
  assert.equal(await bdd.partnerHasRanks("chan-1", ["silver", "gold"]), true);
  assert.equal(await bdd.partnerHasRanks("chan-2", ["gold"]), false);
  await bdd.close();
  assert.equal(await bdd.partnerHasRanks("chan-1", ["gold"]), false, "base fermée : non");
});

test("dropTable : succès, puis échec nommant la table absente", async (t) => {
  const bdd = await freshBdd(t);
  assert.deepEqual(await bdd.dropTable("DailySnapshot"), { success: true, message: "Table dropped successfully." });
  const again = await bdd.dropTable("DailySnapshot");
  assert.equal(again.success, false);
  assert.match(again.message, /^Failed to drop table DailySnapshot\nError: .*no such table/);
});

test("getCurrentTimestamp rend une date valide proche de maintenant", async (t) => {
  const bdd = await freshBdd(t);
  const now = await bdd.getCurrentTimestamp();
  assert.ok(!Number.isNaN(now.getTime()));
  // CURRENT_TIMESTAMP est de l'UTC lu comme heure locale (voir manageMsgExpiration) :
  // l'écart reste borné par le décalage horaire.
  assert.ok(Math.abs(now.getTime() - Date.now()) < 15 * 3600 * 1000);
});

// --- Invitation et rôle arbitre -----------------------------------------------

test("setServerInvite : base fermée, statut d'échec", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.close();
  const status = await bdd.setServerInvite("g1", "https://discord.gg/a", "u1");
  assert.equal(status.success, false);
  assert.match(status.message, /^Error while setting server invite: /);
});

test("rôle arbitre : absent, posé, remplacé sans doublon, retiré", async (t) => {
  const bdd = await freshBdd(t);
  assert.equal(await bdd.getRefereeRole("g1"), null);
  assert.equal((await bdd.setRefereeRole("g1", "role-1", "u1")).success, true);
  assert.equal(await bdd.getRefereeRole("g1"), "role-1");
  assert.deepEqual(await bdd.setRefereeRole("g1", "role-2", "u2"), { success: true, message: "Referee role updated." });
  assert.equal(await bdd.getRefereeRole("g1"), "role-2");
  assert.equal(await count(bdd, "SELECT COUNT(*) AS n FROM RefereeRole WHERE id_guild = 'g1'"), 1);
  const [row] = await bdd.raw<{ set_by: string; updated_at: string }>("SELECT set_by, updated_at FROM RefereeRole");
  assert.equal(row.set_by, "u2");
  assert.ok(row.updated_at);

  assert.equal(await bdd.removeRefereeRole("g1"), true);
  assert.equal(await bdd.getRefereeRole("g1"), null);
  assert.equal(await bdd.removeRefereeRole("g1"), false);
});

test("setRefereeRole : base fermée, statut d'échec", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.close();
  const status = await bdd.setRefereeRole("g1", "r", "u");
  assert.equal(status.success, false);
  assert.match(status.message, /^Error while setting referee role: /);
});

// --- Rétention : transactions annulées -----------------------------------------

test("anonymizeActivityAuthors : une étape en échec annule tout le repli", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.raw("INSERT INTO Scrim (id_author, game, level, id_guild, date) VALUES ('u', 'ow', 'gold', 'g', datetime('now', '-60 day'))");
  await bdd.raw("DROP TABLE ActivityDaily");
  await assert.rejects(bdd.anonymizeActivityAuthors(30), /no such table: ActivityDaily/);
  assert.equal(await count(bdd, "SELECT COUNT(*) AS n FROM Scrim"), 1, "rien d'effacé");
});

test("anonymizeActivityAuthors / normalizeLegacyActivityDetails : base fermée, refus explicite", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.close();
  await assert.rejects(bdd.anonymizeActivityAuthors(30), /Base fermée/);
  await assert.rejects(bdd.normalizeLegacyActivityDetails(), /Base fermée/);
});

test("normalizeLegacyActivityDetails : une table absente annule toute la normalisation", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.raw("INSERT INTO Scrim (id_author, game, level, id_guild) VALUES ('u', 'ow', 'texte libre', 'g')");
  await bdd.raw("DROP TABLE Recrute");
  await assert.rejects(bdd.normalizeLegacyActivityDetails(), /no such table: Recrute/);
  const [row] = await bdd.raw<{ level: string }>("SELECT level FROM Scrim");
  assert.equal(row.level, "texte libre", "réécriture des scrims annulée");
});

test("forgetGuild et claimOwnerApplication : base fermée, rien de fait", async (t) => {
  const bdd = await freshBdd(t);
  await bdd.close();
  assert.deepEqual(await bdd.forgetGuild("g1"), {});
  assert.equal(await bdd.claimOwnerApplication("app"), null);
  await assert.rejects(bdd.listConfiguredGuildIds(), /Base fermée/);
});
