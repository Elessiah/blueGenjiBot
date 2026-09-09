import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Le singleton lit BDD_PATH à sa première ouverture : il doit pointer sur une
// base jetable avant tout import du module testé.
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-restore-"));
process.env.BDD_PATH = path.join(WORK_DIR, "database.sqlite");

// eslint-disable-next-line import/no-named-as-default
const sqlite3 = (await import("sqlite3")).default;
const { open } = await import("sqlite");
const { getBddInstance, resetBddInstance } = await import("../../bdd/Bdd.js");
const { restoreDatabase, validateSqliteFile } = await import("../../backup/restoreDatabase.js");

/** Crée une base SQLite jetable portant une valeur repère. */
async function makeSqliteFile(marker: string): Promise<string> {
  const file = path.join(WORK_DIR, `candidate-${marker}.sqlite`);
  const db = await open({ filename: file, driver: sqlite3.Database });
  await db.exec("CREATE TABLE Repere (valeur TEXT)");
  await db.run("INSERT INTO Repere (valeur) VALUES (?)", [marker]);
  await db.close();
  return file;
}

/** Relit la valeur repère d'une base SQLite. */
async function readMarker(file: string): Promise<string | undefined> {
  const db = await open({ filename: file, driver: sqlite3.Database });
  const row = await db.get<{ valeur: string }>("SELECT valeur FROM Repere LIMIT 1");
  await db.close();
  return row?.valeur;
}

test("validateSqliteFile rejette un fichier absent", async () => {
  const reason = await validateSqliteFile(path.join(WORK_DIR, "absent.sqlite"));

  assert.match(reason ?? "", /illisible/);
});

test("validateSqliteFile rejette une archive encore chiffrée", async () => {
  const file = path.join(WORK_DIR, "archive.tar.age");
  await fs.promises.writeFile(file, "age-encryption.org/v1\nbinaire...");

  assert.match((await validateSqliteFile(file)) ?? "", /pas une base SQLite/);
});

test("validateSqliteFile accepte une base SQLite saine", async () => {
  assert.equal(await validateSqliteFile(await makeSqliteFile("sain")), null);
});

test("restoreDatabase refuse un fichier qui n'est pas une base", async () => {
  const file = path.join(WORK_DIR, "texte.sqlite");
  await fs.promises.writeFile(file, "ceci n'est pas une base");

  const result = await restoreDatabase(file, process.env.BDD_PATH!);

  assert.equal(result.success, false);
  assert.match(result.message, /Restauration refusée/);
});

test("restoreDatabase remplace la base et conserve l'ancienne", async () => {
  // Base de départ : ouverte par le singleton, comme en production.
  await getBddInstance();
  const dbPath = process.env.BDD_PATH!;
  const candidate = await makeSqliteFile("restauree");

  const result = await restoreDatabase(candidate, dbPath);

  assert.equal(result.success, true, result.message);
  assert.equal(await readMarker(dbPath), "restauree");
  assert.ok(result.rollbackPath, "un filet de sécurité doit être écrit");
  assert.ok(fs.existsSync(result.rollbackPath!), "l'ancienne base doit rester sur disque");
});

test("restoreDatabase laisse le singleton utilisable après restauration", async () => {
  const bdd = await getBddInstance();

  // Le singleton a été fermé puis rouvert : une requête doit encore aboutir.
  assert.notEqual(await bdd.get("Repere", ["*"], {}), undefined);
});

test.after(async () => {
  resetBddInstance();
  await fs.promises.rm(WORK_DIR, { recursive: true, force: true }).catch(() => {});
});
