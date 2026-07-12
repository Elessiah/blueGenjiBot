import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const TMP_DB = path.join(os.tmpdir(), `bgenji-invite-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";

test("getServerInvite retourne null quand aucun lien n'est configure", async () => {
  const bdd = await getBddInstance();
  assert.equal(await bdd.getServerInvite("guild-none"), null);
});

test("setServerInvite insere puis getServerInvite retourne le lien", async () => {
  const bdd = await getBddInstance();
  const status = await bdd.setServerInvite("guild-1", "https://discord.gg/aaa", "user-1");
  assert.equal(status.success, true);
  assert.equal(await bdd.getServerInvite("guild-1"), "https://discord.gg/aaa");
});

test("setServerInvite met a jour un lien existant sans dupliquer", async () => {
  const bdd = await getBddInstance();
  await bdd.setServerInvite("guild-2", "https://discord.gg/first", "user-1");
  await bdd.setServerInvite("guild-2", "https://discord.gg/second", "user-2");
  assert.equal(await bdd.getServerInvite("guild-2"), "https://discord.gg/second");
  const rows = await bdd.raw<{ n: number }>("SELECT COUNT(*) AS n FROM ServerInvite WHERE id_guild = ?", ["guild-2"]);
  assert.equal(Number(rows[0].n), 1);
});

test("removeServerInvite supprime un lien et renvoie true, puis false si absent", async () => {
  const bdd = await getBddInstance();
  await bdd.setServerInvite("guild-3", "https://discord.gg/ccc", "user-1");
  assert.equal(await bdd.removeServerInvite("guild-3"), true);
  assert.equal(await bdd.getServerInvite("guild-3"), null);
  assert.equal(await bdd.removeServerInvite("guild-3"), false);
});

test.after(async () => {
  closeBddInstance();
  if (fs.existsSync(TMP_DB)) {
    fs.unlinkSync(TMP_DB);
  }
});
