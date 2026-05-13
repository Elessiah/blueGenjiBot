import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

// Isolation BDD : pointer vers un fichier SQLite temporaire UNIQUE pour ce fichier de test.
// IMPORTANT : doit etre defini AVANT le premier appel a getBddInstance() — donc
// avant tout test, ce qui est garanti car le module-level body s'execute avant
// les test bodies async.
const TMP_DB = path.join(os.tmpdir(), `bgenji-modules-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import { MODULE_KEYS, isValidModule, isModuleEnabled, setModuleEnabled, listModules } from "../../modules/moduleGuard.js";
import { closeBddInstance } from "../../bdd/Bdd.js";

test("MODULE_KEYS contient les 6 modules attendus", () => {
  assert.deepEqual([...MODULE_KEYS].sort(), ["annonces", "notifications", "oauth", "recrutement", "scrims", "stats"]);
});

test("isValidModule reconnait les cles valides et rejette les autres", () => {
  assert.equal(isValidModule("scrims"), true);
  assert.equal(isValidModule("oauth"), true);
  assert.equal(isValidModule("inconnu"), false);
  assert.equal(isValidModule(""), false);
  assert.equal(isValidModule("SCRIMS"), false); // case-sensitive
});

test("isModuleEnabled retourne true par defaut quand aucune ligne en base", async () => {
  const enabled = await isModuleEnabled("111111111111", "scrims");
  assert.equal(enabled, true);
});

test("isModuleEnabled retourne toujours true pour 'oauth' (garde-fou)", async () => {
  await setModuleEnabled("222222222222", "oauth", false); // doit etre ignore (no-op)
  const enabled = await isModuleEnabled("222222222222", "oauth");
  assert.equal(enabled, true);
});

test("setModuleEnabled persiste l'etat puis isModuleEnabled le retrouve", async () => {
  const guildId = "333333333333";
  await setModuleEnabled(guildId, "scrims", false);
  assert.equal(await isModuleEnabled(guildId, "scrims"), false);
  await setModuleEnabled(guildId, "scrims", true);
  assert.equal(await isModuleEnabled(guildId, "scrims"), true);
});

test("listModules retourne les 6 modules; oauth force a true; defaut true pour les autres", async () => {
  const guildId = "444444444444";
  await setModuleEnabled(guildId, "annonces", false);
  const mods = await listModules(guildId);
  assert.equal(mods.length, 6);
  const map = new Map(mods.map((m) => [m.key, m.enabled]));
  assert.equal(map.get("annonces"), false);
  assert.equal(map.get("oauth"), true);
  assert.equal(map.get("scrims"), true); // pas de ligne -> defaut true
});

test.after(async () => {
  closeBddInstance();
  // Petit delai pour laisser sqlite fermer le handle Windows
  await new Promise((r) => setTimeout(r, 50));
  try { fs.unlinkSync(TMP_DB); } catch { /* noop */ }
});
