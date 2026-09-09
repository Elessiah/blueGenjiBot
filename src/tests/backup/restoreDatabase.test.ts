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
const { KEPT_ROLLBACKS, purgeOldRollbacks, restoreDatabase, validateSqliteFile } =
  await import("../../backup/restoreDatabase.js");

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

test("restoreDatabase remet la base precedente en place si la copie echoue", async () => {
  await getBddInstance();
  const dbPath = process.env.BDD_PATH!;
  const candidate = await makeSqliteFile("jamais-appliquee");

  // La copie echoue apres la creation du filet de securite : c'est exactement
  // la fenetre ou la base de production peut rester tronquee.
  const vraieCopie = fs.promises.copyFile;
  let premiere = true;
  (fs.promises as { copyFile: typeof vraieCopie }).copyFile = async (...args) => {
    if (premiere) {
      premiere = false;
      throw new Error("disque plein");
    }
    return vraieCopie(...(args as Parameters<typeof vraieCopie>));
  };

  let result;
  try {
    result = await restoreDatabase(candidate, dbPath);
  } finally {
    (fs.promises as { copyFile: typeof vraieCopie }).copyFile = vraieCopie;
  }

  assert.equal(result.success, false);
  assert.match(result.message, /disque plein/);
  assert.match(result.message, /remise en place/);
  // La base reste celle d'avant, pas celle qu'on tentait de restaurer.
  assert.notEqual(await readMarker(dbPath), "jamais-appliquee");
  assert.ok((await getBddInstance()) !== undefined, "le bot doit rester utilisable");
});

test("purgeOldRollbacks ne garde que les copies les plus recentes", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-purge-"));
  const dbPath = path.join(dir, "database.sqlite");
  // Suffixes horodates : le tri lexicographique doit designer les plus anciens.
  const stamps = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01", "2026-05-01"];
  for (const stamp of stamps) {
    await fs.promises.writeFile(`${dbPath}.avant-${stamp}`, "copie");
  }

  const removed = await purgeOldRollbacks(dbPath);
  const restants = (await fs.promises.readdir(dir)).sort();

  assert.equal(removed, stamps.length - KEPT_ROLLBACKS);
  assert.deepEqual(restants, [
    "database.sqlite.avant-2026-03-01",
    "database.sqlite.avant-2026-04-01",
    "database.sqlite.avant-2026-05-01",
  ]);
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test("purgeOldRollbacks laisse intactes les copies sous le seuil", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-purge-"));
  const dbPath = path.join(dir, "database.sqlite");
  await fs.promises.writeFile(`${dbPath}.avant-2026-01-01`, "copie");
  // Un fichier voisin qui ne porte pas le prefixe ne doit jamais etre touche.
  await fs.promises.writeFile(path.join(dir, "database.sqlite"), "base");

  assert.equal(await purgeOldRollbacks(dbPath), 0);
  assert.equal((await fs.promises.readdir(dir)).length, 2);
  await fs.promises.rm(dir, { recursive: true, force: true });
});

test("purgeOldRollbacks ne leve pas sur un dossier absent", async () => {
  assert.equal(await purgeOldRollbacks("/dossier/absent/database.sqlite"), 0);
});

test.after(async () => {
  await resetBddInstance();
  await fs.promises.rm(WORK_DIR, { recursive: true, force: true }).catch(() => {});
});
