import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Client } from "discord.js";

import { sendDatabaseBackup } from "../../backup/weeklyBackup.js";
import type { BackupCheckReport } from "../../backup/backupCheck.js";

type Sent = { content: string; allowedMentions?: unknown };

/** Faux client : le titulaire reçoit ses messages privés dans `sent`. */
function ownerClient(sent: Sent[], failFetch = false): Client {
  return {
    users: {
      fetch: async () => {
        if (failFetch) throw new Error("Unknown User");
        return { send: async (payload: Sent) => { sent.push(payload); return { id: "dm" }; } };
      },
    },
  } as unknown as Client;
}

/** Contrôles de relecture simulés, sans aucune commande lancée. */
const checksWith = (ok: boolean, detail = "ok") => async (): Promise<BackupCheckReport> => ({
  checks: [{ label: "Archive la plus récente", ok, detail }],
  publicKey: null,
});

/** Exécute `fn` avec un environnement de sauvegarde temporaire, puis le rétablit. */
async function withBackupEnv(env: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bluegenji-weekly-"));
  const keys = ["OWNER_ID", "BACKUP_STATUS_PATH", "BDD_PATH"] as const;
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const values: Record<string, string | undefined> = {
    OWNER_ID: "700000000000000001",
    BACKUP_STATUS_PATH: path.join(dir, "absent.json"),
    BDD_PATH: path.join(dir, "bdd.sqlite"),
    ...env,
  };
  for (const key of keys) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  try {
    await fn();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

test("sendDatabaseBackup : le rapport au titulaire n'appelle aucune mention", () =>
  withBackupEnv({}, async () => {
    const sent: Sent[] = [];
    const ok = await sendDatabaseBackup(ownerClient(sent), checksWith(false, "@everyone <@&123456789012345678>"));
    assert.equal(ok, true);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { parse: [] });
    assert.match(sent[0].content, /^🚨 Sauvegarde BlueGenji à vérifier/);
    assert.match(sent[0].content, /@everyone/);
  }));

test("sendDatabaseBackup : sans OWNER_ID, rien ne part", () =>
  withBackupEnv({ OWNER_ID: undefined }, async () => {
    const sent: Sent[] = [];
    let ran = false;
    const ok = await sendDatabaseBackup(ownerClient(sent), async () => { ran = true; return checksWith(true)(); });
    assert.equal(ok, false);
    assert.equal(ran, false);
    assert.deepEqual(sent, []);
  }));

test("sendDatabaseBackup : un titulaire injoignable rend false sans lever", () =>
  withBackupEnv({}, async () => {
    const ok = await sendDatabaseBackup(ownerClient([], true), checksWith(true));
    assert.equal(ok, false);
  }));
