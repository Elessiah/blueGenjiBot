import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const TMP_DB = path.join(os.tmpdir(), `bgenji-raw-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";

test("bdd.raw execute une requete parametree et retourne les lignes typees", async () => {
  const bdd = await getBddInstance();
  await bdd.set("OGMsg", ["id_msg", "id_author"], ["raw-test-1", "author-1"]);
  await bdd.set("OGMsg", ["id_msg", "id_author"], ["raw-test-2", "author-2"]);
  const rows = await bdd.raw<{ total: number }>("SELECT COUNT(*) AS total FROM OGMsg WHERE id_author = ?", ["author-1"]);
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].total), 1);
});

test("bdd.raw renvoie tableau vide si aucun match", async () => {
  const bdd = await getBddInstance();
  const rows = await bdd.raw<{ id_msg: string }>("SELECT id_msg FROM OGMsg WHERE id_author = ?", ["inexistant"]);
  assert.deepEqual(rows, []);
});

test("bdd.raw supporte les requetes GROUP BY (cas reel: stats par bucket)", async () => {
  const bdd = await getBddInstance();
  await bdd.set("OGMsg", ["id_msg", "id_author"], ["raw-grp-1", "a"]);
  await bdd.set("OGMsg", ["id_msg", "id_author"], ["raw-grp-2", "a"]);
  await bdd.set("OGMsg", ["id_msg", "id_author"], ["raw-grp-3", "b"]);
  const rows = await bdd.raw<{ id_author: string; n: number }>("SELECT id_author, COUNT(*) AS n FROM OGMsg WHERE id_author IN (?, ?) GROUP BY id_author ORDER BY id_author", ["a", "b"]);
  assert.equal(rows.length, 2);
  const mapped = Object.fromEntries(rows.map((r) => [r.id_author, Number(r.n)]));
  assert.equal(mapped["a"], 2);
  assert.equal(mapped["b"], 1);
});

test.after(async () => {
  closeBddInstance();
  await new Promise((r) => setTimeout(r, 50));
  try {
    fs.unlinkSync(TMP_DB);
  } catch { /* noop */ }
});
