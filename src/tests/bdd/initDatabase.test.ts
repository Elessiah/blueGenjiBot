import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

import { Bdd } from "../../bdd/Bdd.js";
import { ranks, services } from "../../utils/globals.js";

/**
 * Caractérisation de `Bdd.initDatabase` : le schéma obtenu sur une base neuve
 * et sur une base ancienne, les lignes de console, et l'indépendance des
 * étapes — une étape qui échoue est écrite sur la console sous son libellé et
 * n'empêche pas les suivantes.
 */

const TMP_DIR = path.join(os.tmpdir(), "bgenji-init-db-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });

const EXPECTED_TABLES = [
  "ActivityDaily", "AdhesionInterval", "Ban", "BotOwner", "ChannelPartner", "ChannelPartnerRank",
  "ChannelPartnerService", "DPMsg", "DailySnapshot", "FeedEvent", "MessageService", "OGMsg", "Ranks",
  "Recrute", "RefereeRole", "RoleAdmin", "Scrim", "ServerInvite", "ServerModule", "Service", "SiteVisit",
];

type Captured = { logs: string[]; errors: unknown[][] };

/** Ouvre une base par `Bdd.create`, en relevant la console. */
async function create(file: string, t: test.TestContext): Promise<{ bdd: Bdd } & Captured> {
  const captured: Captured = { logs: [], errors: [] };
  t.mock.method(console, "log", (...parts: unknown[]) => { captured.logs.push(parts.map(String).join(" ")); });
  t.mock.method(console, "error", (...parts: unknown[]) => { captured.errors.push(parts); });
  const bdd = await Bdd.create(file);
  t.mock.restoreAll();
  // Fermée même si une assertion échoue : sous Windows, un fichier ouvert bloque le nettoyage.
  t.after(() => bdd.close());
  return { bdd, ...captured };
}

async function tables(bdd: Bdd): Promise<string[]> {
  const rows = await bdd.raw<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name", []);
  return rows.map((r) => r.name);
}

async function columns(bdd: Bdd, table: string): Promise<string[]> {
  return (await bdd.raw<{ name: string }>(`SELECT name FROM pragma_table_info('${table}')`, [])).map((r) => r.name);
}

/** Prépare un fichier SQLite brut, avant toute ouverture par `Bdd`. */
async function prepare(file: string, sql: string): Promise<void> {
  const db = await open({ filename: file, driver: sqlite3.Database });
  await db.exec(sql);
  await db.close();
}

test("base neuve : toutes les tables, services et rangs semés, aucune erreur", async (t) => {
  const { bdd, logs, errors } = await create(path.join(TMP_DIR, "neuve.sqlite"), t);
  assert.deepEqual(await tables(bdd), EXPECTED_TABLES);
  assert.deepEqual((await bdd.raw<{ name: string }>("SELECT name FROM Service ORDER BY id_service", [])).map((r) => r.name), services);
  assert.deepEqual((await bdd.raw<{ name: string }>("SELECT name FROM Ranks ORDER BY id_rank", [])).map((r) => r.name), ranks);
  assert.deepEqual(errors, []);
  assert.deepEqual(logs.filter((l) => l.startsWith("Adding")), [
    ...services.map((s) => `Adding "${s}" to the database...`),
    ...ranks.map((r) => `Adding "${r}" to the database...`),
  ]);
  assert.equal((await bdd.raw<{ secure_delete: number }>("PRAGMA secure_delete", []))[0].secure_delete, 1);
  assert.equal((await bdd.raw<{ timeout: number }>("PRAGMA busy_timeout", []))[0].timeout, 5000);
});

test("seconde ouverture : rien de resemé, rien d'écrit sur la console", async (t) => {
  const file = path.join(TMP_DIR, "neuve.sqlite");
  const { bdd, logs, errors } = await create(file, t);
  assert.deepEqual(logs.filter((l) => l.startsWith("Adding")), []);
  assert.deepEqual(errors, []);
  assert.equal((await bdd.raw("SELECT * FROM Service", [])).length, services.length);
});

test("base ancienne : colonnes ajoutées, table UserLink et modules retirés supprimés", async (t) => {
  const file = path.join(TMP_DIR, "ancienne.sqlite");
  await prepare(file, `
    CREATE TABLE ChannelPartner (id_channel TEXT PRIMARY KEY, id_guild TEXT);
    INSERT INTO ChannelPartner VALUES ('c1', 'g1');
    CREATE TABLE Ban (id_user TEXT PRIMARY KEY, id_moderator TEXT NOT NULL, id_reason TEXT NOT NULL, date DATETIME DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE UserLink (id_user TEXT, code TEXT);
    CREATE TABLE ServerModule (id_guild TEXT NOT NULL, module_key TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, PRIMARY KEY (id_guild, module_key));
    INSERT INTO ServerModule VALUES ('g1', 'oauth', 1), ('g1', 'stats', 0), ('g1', 'annonces', 1);
  `);
  const { bdd, errors } = await create(file, t);
  assert.deepEqual(errors, []);
  assert.deepEqual(await tables(bdd), EXPECTED_TABLES);
  assert.ok((await columns(bdd, "ChannelPartner")).includes("region"));
  assert.deepEqual(await bdd.raw("SELECT region FROM ChannelPartner WHERE id_channel = 'c1'", []), [{ region: 0 }]);
  assert.deepEqual((await columns(bdd, "Ban")).slice(-2), ["id_reason_owner", "id_notice_admin"]);
  assert.deepEqual(await bdd.raw("SELECT module_key FROM ServerModule", []), [{ module_key: "annonces" }]);
});

test("étape en échec : écrite sous son libellé, les suivantes jouées", async (t) => {
  const file = path.join(TMP_DIR, "abimee.sqlite");
  // `Service` sans colonne `name` (le semis lève, avec l'erreur entière),
  // `ServerModule` sans `module_key` (le nettoyage des modules lève).
  await prepare(file, `
    CREATE TABLE Service (id_service INTEGER PRIMARY KEY AUTOINCREMENT, label TEXT);
    CREATE TABLE ServerModule (id_guild TEXT NOT NULL, enabled INTEGER);
  `);
  const { bdd, errors } = await create(file, t);
  assert.equal(errors.length, 2);
  assert.equal(errors[0].length, 3);
  assert.equal(errors[0][0], "Service&Co");
  assert.match(String(errors[0][1]), /no such column: name/);
  assert.ok(errors[0][2] instanceof Error);
  assert.equal(errors[1].length, 2);
  assert.equal(errors[1][0], "ServerModule oauth cleanup error: ");
  assert.match(String(errors[1][1]), /no such column: module_key/);
  // Les tables des étapes suivantes existent quand même.
  assert.deepEqual(await tables(bdd), EXPECTED_TABLES);
});

test("nettoyage du dossier temporaire", () => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  assert.equal(fs.existsSync(TMP_DIR), false);
});
