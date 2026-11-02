import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { Client } from "discord.js";

process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { saveAdhesionPaths } from "../../adhesion/saveAdhesionPaths.js";

const EMPTY_PATHS = { adhesion: "", adhesionName: "", status: "", statusName: "" };

/** Faux client : relève le texte et les `flags` de chaque envoi au salon de supervision. */
function logClient(sent: { content: string; flags: unknown }[]): Client {
  return {
    users: { fetch: async () => ({ send: async () => ({ id: "dm" }) }) },
    channels: { fetch: async () => ({ send: async (payload: { content: string; flags?: unknown }) => {
      sent.push({ content: payload.content, flags: payload.flags ?? null });
      return { id: "log" };
    } }) },
  } as unknown as Client;
}

/** Exécute `fn` avec `ADHESIONS_PATH` désigné, puis le rétablit. */
async function withAdhesionsPath(dir: string, fn: () => Promise<void>): Promise<void> {
  const saved = process.env.ADHESIONS_PATH;
  process.env.ADHESIONS_PATH = dir;
  try {
    await fn();
  } finally {
    if (saved === undefined) delete process.env.ADHESIONS_PATH;
    else process.env.ADHESIONS_PATH = saved;
  }
}

test("saveAdhesionPaths_writableDir_writesFileWithoutLog", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bgenji-adh-save-"));
  try {
    await withAdhesionsPath(dir, async () => {
      const sent: { content: string; flags: unknown }[] = [];

      const ok = await saveAdhesionPaths(EMPTY_PATHS, undefined, logClient(sent));

      assert.equal(ok, true);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "paths.json"), "utf-8")), EMPTY_PATHS);
      assert.deepEqual(sent, []);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("saveAdhesionPaths_unwritableDir_alertNotifies", async () => {
  const missing = path.join(os.tmpdir(), "bgenji-adh-missing-" + randomUUID());
  await withAdhesionsPath(missing, async () => {
    const sent: { content: string; flags: unknown }[] = [];

    const ok = await saveAdhesionPaths(EMPTY_PATHS, undefined, logClient(sent));

    assert.equal(ok, false);
    assert.equal(sent.length, 1);
    assert.match(sent[0].content, /^Impossible de sauvegarder le fichier de configuration des adhésions/);
    assert.equal(sent[0].flags, null);
  });
});
