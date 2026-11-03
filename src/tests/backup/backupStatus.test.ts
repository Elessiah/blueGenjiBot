import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  formatBackupFailures,
  formatBackupStatus,
  isBackupFresh,
  readBackupFailures,
  readBackupStatus,
  STALE_AFTER_MS,
  type BackupStatus,
} from "../../backup/backupStatus.js";

const NOW = Date.parse("2026-09-09T04:00:00+02:00");

/** Écrit un fichier de statut temporaire et renvoie son chemin. */
async function writeStatusFile(content: string): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bluegenji-status-"));
  const file = path.join(dir, "backup-status.json");
  await fs.promises.writeFile(file, content, "utf8");
  return file;
}

const OK_STATUS: BackupStatus = {
  date: "2026-09-08T04:00:00+02:00",
  ok: true,
  remote: "onedrive:BlueGenji/backups/bluegenji-2026-09-08.tar.age",
  sizeBytes: 12 * 1024 * 1024,
  parts: "sqlite+mysql",
  error: "",
};

test("readBackupStatus renvoie null si le fichier n'existe pas", async () => {
  assert.equal(await readBackupStatus("/chemin/absent/backup-status.json"), null);
});

test("readBackupStatus renvoie null sur un JSON invalide", async () => {
  const file = await writeStatusFile("{ pas du json");

  assert.equal(await readBackupStatus(file), null);
});

test("readBackupStatus renvoie null si les champs essentiels manquent", async () => {
  const file = await writeStatusFile(JSON.stringify({ remote: "onedrive:x" }));

  assert.equal(await readBackupStatus(file), null);
});

test("readBackupStatus relit le statut écrit par le script", async () => {
  const file = await writeStatusFile(JSON.stringify(OK_STATUS));
  const status = await readBackupStatus(file);

  assert.equal(status?.ok, true);
  assert.equal(status?.parts, "sqlite+mysql");
  assert.equal(status?.sizeBytes, 12 * 1024 * 1024);
});

test("readBackupStatus complète les champs optionnels absents", async () => {
  const file = await writeStatusFile(JSON.stringify({ date: OK_STATUS.date, ok: false }));
  const status = await readBackupStatus(file);

  assert.equal(status?.remote, "");
  assert.equal(status?.sizeBytes, 0);
  assert.equal(status?.error, "");
});

test("isBackupFresh accepte une sauvegarde réussie de la veille", () => {
  assert.equal(isBackupFresh(OK_STATUS, NOW), true);
});

test("isBackupFresh refuse une sauvegarde en échec, même récente", () => {
  assert.equal(isBackupFresh({ ...OK_STATUS, ok: false }, NOW), false);
});

test("isBackupFresh refuse une sauvegarde de plus de trois jours", () => {
  const old = { ...OK_STATUS, date: "2026-08-25T04:00:00+02:00" };

  assert.equal(isBackupFresh(old, NOW), false);
});

test("isBackupFresh refuse une date illisible", () => {
  assert.equal(isBackupFresh({ ...OK_STATUS, date: "jamais" }, NOW), false);
});

test("isBackupFresh refuse l'absence de statut", () => {
  assert.equal(isBackupFresh(null, NOW), false);
});

test("formatBackupStatus signale un script jamais exécuté", () => {
  assert.match(formatBackupStatus(null, NOW), /aucune sauvegarde enregistrée/);
});

test("formatBackupStatus détaille une sauvegarde réussie", () => {
  const line = formatBackupStatus(OK_STATUS, NOW);

  assert.match(line, /^☁️ /);
  assert.match(line, /sqlite\+mysql sauvegardée le 2026-09-08/);
  assert.match(line, /12,0 Mo/);
});

test("formatBackupStatus remonte la cause d'un échec", () => {
  const line = formatBackupStatus({ ...OK_STATUS, ok: false, error: "mysqldump a échoué" }, NOW);

  assert.match(line, /^❌ /);
  assert.match(line, /mysqldump a échoué/);
});

test("formatBackupStatus alerte sur une sauvegarde périmée", () => {
  const line = formatBackupStatus({ ...OK_STATUS, date: "2026-08-25T04:00:00+02:00" }, NOW);

  assert.match(line, /^⚠️ /);
  assert.match(line, /Sauvegarde périmée/);
});

test("isBackupFresh_justUnderThreeDays_true", () => {
  const status = { ...OK_STATUS, date: new Date(NOW - STALE_AFTER_MS + 1).toISOString() };
  assert.equal(isBackupFresh(status, NOW), true);
});

test("isBackupFresh_exactlyThreeDays_false", () => {
  // Dimanche manqué : la dernière réussie serait celle du mardi, six jours plus tôt.
  const status = { ...OK_STATUS, date: new Date(NOW - STALE_AFTER_MS).toISOString() };
  assert.equal(STALE_AFTER_MS, 3 * 24 * 60 * 60 * 1000);
  assert.equal(isBackupFresh(status, NOW), false);
});

/** Écrit un historique temporaire (une ligne par entrée) et renvoie son chemin. */
async function writeHistoryFile(lines: string[]): Promise<string> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "bluegenji-history-"));
  const file = path.join(dir, "backup-status-history.jsonl");
  await fs.promises.writeFile(file, lines.join("\n") + "\n", "utf8");
  return file;
}

test("readBackupFailures_missingFile_empty", async () => {
  assert.deepEqual(await readBackupFailures("/chemin/absent/history.jsonl", NOW), []);
});

test("readBackupFailures_failureInWindow_returned", async () => {
  const file = await writeHistoryFile([
    '{"date":"2026-09-02T23:49:00+02:00","ok":false,"error":"rclone injoignable"}',
    '{"date":"2026-09-06T23:49:00+02:00","ok":true,"error":""}',
  ]);
  assert.deepEqual(await readBackupFailures(file, NOW), [
    { date: "2026-09-02T23:49:00+02:00", ok: false, error: "rclone injoignable" },
  ]);
});

test("readBackupFailures_oldFutureOrInvalidLines_ignored", async () => {
  const file = await writeHistoryFile([
    '{"date":"2026-08-25T23:49:00+02:00","ok":false,"error":"trop ancien"}',
    '{"date":"2026-09-20T23:49:00+02:00","ok":false,"error":"dans le futur"}',
    "pas du json",
    '{"ok":false}',
    "",
  ]);
  assert.deepEqual(await readBackupFailures(file, NOW), []);
});

test("readBackupFailures_missingError_emptyString", async () => {
  const file = await writeHistoryFile(['{"date":"2026-09-08T23:49:00+02:00","ok":false}']);
  assert.deepEqual(await readBackupFailures(file, NOW), [{ date: "2026-09-08T23:49:00+02:00", ok: false, error: "" }]);
});

test("formatBackupFailures_none_null", () => {
  assert.equal(formatBackupFailures([]), null);
});

test("formatBackupFailures_some_oneLinePerFailure", () => {
  assert.equal(
    formatBackupFailures([
      { date: "2026-09-02T23:49:00+02:00", ok: false, error: "rclone injoignable" },
      { date: "2026-09-03T23:49:00+02:00", ok: false, error: "" },
    ]),
    "❌ Échec depuis le rapport précédent : 2026-09-02 — rclone injoignable.\n" +
      "❌ Échec depuis le rapport précédent : 2026-09-03 — cause inconnue.",
  );
});
