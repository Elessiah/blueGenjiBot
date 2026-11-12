import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageFlags, type Client } from "discord.js";

import { backupHistoryPath, sendDatabaseBackup } from "../../backup/weeklyBackup.js";
import { IGNORED_HISTORY_LINE, runningMarkerPath } from "../../backup/backupStatus.js";
import type { BackupCheckReport } from "../../backup/backupCheck.js";

type Sent = { content: string; allowedMentions?: unknown; flags?: unknown };

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

test("sendDatabaseBackup_healthyBackup_sentSilent", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bluegenji-weekly-fresh-"));
  const statusPath = path.join(dir, "status.json");
  await fs.promises.writeFile(statusPath, JSON.stringify({ date: new Date().toISOString(), ok: true }));
  try {
    await withBackupEnv({ BACKUP_STATUS_PATH: statusPath }, async () => {
      const sent: Sent[] = [];

      await sendDatabaseBackup(ownerClient(sent), checksWith(true));

      assert.match(sent[0].content, /^🗄️ Rapport de sauvegarde BlueGenji/);
      assert.equal(sent[0].flags, MessageFlags.SuppressNotifications);
    });
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("sendDatabaseBackup_backupToCheck_notifies", () =>
  withBackupEnv({}, async () => {
    const sent: Sent[] = [];

    await sendDatabaseBackup(ownerClient(sent), checksWith(false));

    assert.match(sent[0].content, /^🚨 Sauvegarde BlueGenji à vérifier/);
    assert.equal(sent[0].flags, undefined);
  }));

test("sendDatabaseBackup_failureSinceLastReport_alertsWithFailureLine", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bluegenji-weekly-history-"));
  const statusPath = path.join(dir, "status.json");
  const failedAt = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
  await fs.promises.writeFile(statusPath, JSON.stringify({ date: new Date().toISOString(), ok: true }));
  // Même défaut que le script : à côté du statut, `-history.jsonl`.
  await fs.promises.writeFile(path.join(dir, "status-history.jsonl"), JSON.stringify({ date: failedAt, ok: false, error: "rclone injoignable" }) + "\n");
  try {
    await withBackupEnv({ BACKUP_STATUS_PATH: statusPath }, async () => {
      const sent: Sent[] = [];

      await sendDatabaseBackup(ownerClient(sent), checksWith(true));

      assert.match(sent[0].content, /^🚨 Sauvegarde BlueGenji à vérifier/);
      assert.ok(sent[0].content.includes(`❌ Échec depuis le rapport précédent : ${failedAt.slice(0, 10)} — rclone injoignable.`));
      assert.equal(sent[0].flags, undefined);
    });
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("sendDatabaseBackup_latestRunFailed_failureNotRepeatedFromHistory", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bluegenji-weekly-latest-"));
  const statusPath = path.join(dir, "status.json");
  const date = new Date().toISOString();
  await fs.promises.writeFile(statusPath, JSON.stringify({ date, ok: false, error: "rclone injoignable" }));
  await fs.promises.writeFile(path.join(dir, "status-history.jsonl"), JSON.stringify({ date, ok: false, error: "rclone injoignable" }) + "\n");
  try {
    await withBackupEnv({ BACKUP_STATUS_PATH: statusPath }, async () => {
      const sent: Sent[] = [];

      await sendDatabaseBackup(ownerClient(sent), checksWith(true));

      assert.doesNotMatch(sent[0].content, /Échec depuis le rapport précédent/);
    });
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("sendDatabaseBackup_runningMarkerKeepsOlderStatusHealthy_sentSilent", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bluegenji-weekly-running-"));
  const statusPath = path.join(dir, "status.json");
  // Statut du mardi soir, sauvegarde du dimanche encore en cours au rapport du lundi.
  const tuesday = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString();
  await fs.promises.writeFile(statusPath, JSON.stringify({ date: tuesday, ok: true }));
  await fs.promises.writeFile(runningMarkerPath(statusPath), new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString());
  try {
    await withBackupEnv({ BACKUP_STATUS_PATH: statusPath }, async () => {
      const sent: Sent[] = [];

      await sendDatabaseBackup(ownerClient(sent), checksWith(true));

      assert.match(sent[0].content, /^🗄️ Rapport de sauvegarde BlueGenji/);
      assert.match(sent[0].content, /Sauvegarde suivante en cours depuis le/);
      assert.equal(sent[0].flags, MessageFlags.SuppressNotifications);
    });
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("sendDatabaseBackup_historyFileNamedInStatus_failureReported", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bluegenji-weekly-histpath-"));
  const statusPath = path.join(dir, "status.json");
  // Historique renommé par le seul script (`STATUS_HISTORY_FILE`), dans le dossier du statut :
  // le statut en donne le chemin.
  const historyFile = path.join(dir, "historique.jsonl");
  const failedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  await fs.promises.writeFile(historyFile, JSON.stringify({ date: failedAt, ok: false, error: "rclone injoignable" }) + "\n");
  await fs.promises.writeFile(statusPath, JSON.stringify({ date: new Date().toISOString(), ok: true, historyFile }));
  try {
    await withBackupEnv({ BACKUP_STATUS_PATH: statusPath }, async () => {
      const sent: Sent[] = [];

      await sendDatabaseBackup(ownerClient(sent), checksWith(true));

      assert.ok(sent[0].content.includes(`❌ Échec depuis le rapport précédent : ${failedAt.slice(0, 10)} — rclone injoignable.`));
    });
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("sendDatabaseBackup_historyIgnored_alertHeaderAndLine", async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bluegenji-weekly-histignored-"));
  const statusPath = path.join(dir, "status.json");
  // Historique désigné hors du dossier du statut, non déclaré au bot : refusé.
  const historyFile = path.join(os.tmpdir(), "ailleurs", "historique.jsonl");
  await fs.promises.writeFile(statusPath, JSON.stringify({ date: new Date().toISOString(), ok: true, historyFile }));
  try {
    await withBackupEnv({ BACKUP_STATUS_PATH: statusPath }, async () => {
      const sent: Sent[] = [];

      await sendDatabaseBackup(ownerClient(sent), checksWith(true));

      assert.ok(sent[0].content.startsWith("🚨 Sauvegarde BlueGenji à vérifier"));
      assert.ok(sent[0].content.includes(IGNORED_HISTORY_LINE));
    });
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test("backupHistoryPath_statusNamesHistoryFile_returnsIt", () => {
  const status = { date: "", ok: true, remote: "", sizeBytes: 0, parts: "", error: "", historyFile: "/srv/h.jsonl" };

  assert.equal(backupHistoryPath("/var/lib/bluegenji/backup-status.json", status), "/srv/h.jsonl");
});

test("backupHistoryPath_noHistoryFileButEnv_returnsEnv", () => {
  const saved = process.env.BACKUP_STATUS_HISTORY_PATH;
  process.env.BACKUP_STATUS_HISTORY_PATH = "/env/h.jsonl";
  try {
    assert.equal(backupHistoryPath("/var/lib/bluegenji/backup-status.json", null), "/env/h.jsonl");
  } finally {
    if (saved === undefined) delete process.env.BACKUP_STATUS_HISTORY_PATH;
    else process.env.BACKUP_STATUS_HISTORY_PATH = saved;
  }
});

test("backupHistoryPath_nothingSet_returnsScriptDefault", () => {
  const saved = process.env.BACKUP_STATUS_HISTORY_PATH;
  delete process.env.BACKUP_STATUS_HISTORY_PATH;
  try {
    assert.equal(backupHistoryPath("/var/lib/bluegenji/backup-status.json", null), "/var/lib/bluegenji/backup-status-history.jsonl");
  } finally {
    if (saved !== undefined) process.env.BACKUP_STATUS_HISTORY_PATH = saved;
  }
});
