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
  FAILURE_CAUSE_MAX_LENGTH,
  readBackupStatus,
  isProcessAlive,
  readRunningSince,
  runningMarkerPath,
  RUNNING_GRACE_MS,
  RUNNING_MAX_AGE_MS,
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
  historyFile: "",
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

test("formatBackupFailures_longCause_shortened", () => {
  const cause = "x".repeat(FAILURE_CAUSE_MAX_LENGTH + 50);
  assert.equal(
    formatBackupFailures([{ date: "2026-09-01T23:49:00+02:00", ok: false, error: cause }]),
    `❌ Échec depuis le rapport précédent : 2026-09-01 — ${"x".repeat(FAILURE_CAUSE_MAX_LENGTH)}….`,
  );
});

test("readBackupStatus_absoluteHistoryFile_returnsIt", async () => {
  const historyFile = path.join(os.tmpdir(), "ailleurs", "history.jsonl");
  const file = await writeStatusFile(JSON.stringify({ ...OK_STATUS, historyFile }));

  assert.equal((await readBackupStatus(file))?.historyFile, historyFile);
});

test("readBackupStatus_relativeHistoryFile_returnsEmpty", async () => {
  const file = await writeStatusFile(JSON.stringify({ ...OK_STATUS, historyFile: "history.jsonl" }));

  assert.equal((await readBackupStatus(file))?.historyFile, "");
});

/** Statut temporaire accompagné d'un marqueur de sauvegarde en cours. */
async function withRunningMarker(content: string): Promise<string> {
  const file = await writeStatusFile("{}");
  await fs.promises.writeFile(runningMarkerPath(file), content, "utf8");
  return file;
}

const REPORT_AT = Date.parse("2026-11-09T03:00:00Z");
/** Test de vie d'un PID : tous vivants (les PID des marqueurs de test sont fictifs). */
const ALIVE = (): boolean => true;

test("readRunningSince_recentMarker_returnsStart", async () => {
  const file = await withRunningMarker("2026-11-08T22:49:00+00:00\n");

  assert.equal(await readRunningSince(file, REPORT_AT), Date.parse("2026-11-08T22:49:00Z"));
});

test("readRunningSince_noMarker_returnsNull", async () => {
  const file = await writeStatusFile("{}");

  assert.equal(await readRunningSince(file, REPORT_AT), null);
});

test("readRunningSince_markerOlderThanMaxAge_returnsNull", async () => {
  const file = await withRunningMarker(new Date(REPORT_AT - RUNNING_MAX_AGE_MS).toISOString());

  assert.equal(await readRunningSince(file, REPORT_AT), null);
});

test("readRunningSince_markerJustUnderMaxAge_returnsStart", async () => {
  const start = REPORT_AT - RUNNING_MAX_AGE_MS + 1000;
  const file = await withRunningMarker(new Date(start).toISOString());

  assert.equal(await readRunningSince(file, REPORT_AT), start);
});

test("readRunningSince_futureMarker_returnsNull", async () => {
  const file = await withRunningMarker("2026-11-10T00:00:00Z");

  assert.equal(await readRunningSince(file, REPORT_AT), null);
});

test("readRunningSince_lineWithPid_returnsStart", async () => {
  const file = await withRunningMarker("2026-11-08T22:49:00+00:00 4242\n");

  assert.equal(await readRunningSince(file, REPORT_AT, ALIVE), Date.parse("2026-11-08T22:49:00Z"));
});

test("readRunningSince_twoOverlappingRuns_returnsEarliestStart", async () => {
  const file = await withRunningMarker("2026-11-08T23:10:00+00:00 5151\n2026-11-08T22:49:00+00:00 4242\n");

  assert.equal(await readRunningSince(file, REPORT_AT, ALIVE), Date.parse("2026-11-08T22:49:00Z"));
});

test("readRunningSince_staleAndRecentLines_ignoresTheStaleOne", async () => {
  const stale = new Date(REPORT_AT - RUNNING_MAX_AGE_MS).toISOString();
  const file = await withRunningMarker(`${stale} 1\ndemain 2\n2026-11-08T22:49:00+00:00 4242\n`);

  assert.equal(await readRunningSince(file, REPORT_AT, ALIVE), Date.parse("2026-11-08T22:49:00Z"));
});

test("readRunningSince_emptyMarker_returnsNull", async () => {
  const file = await withRunningMarker("");

  assert.equal(await readRunningSince(file, REPORT_AT), null);
});

test("readRunningSince_unreadableDate_returnsNull", async () => {
  const file = await withRunningMarker("demain");

  assert.equal(await readRunningSince(file, REPORT_AT), null);
});

/** Statut réussi daté de `ageMs` avant le rapport. */
const okStatusAged = (ageMs: number): BackupStatus => ({ ...OK_STATUS, date: new Date(REPORT_AT - ageMs).toISOString() });
const HOUR = 60 * 60 * 1000;

/** Statut du mardi 23 h 49 (heure de Paris), relu au rapport du lundi 4 h : 5 jours 4 h 11. */
const TUESDAY_STATUS: BackupStatus = { ...OK_STATUS, date: "2026-11-03T22:49:00.000Z" };

test("isBackupFresh_runningAndTuesdayStatus_returnsTrue", () => {
  assert.equal(isBackupFresh(TUESDAY_STATUS, REPORT_AT, true), true);
});

test("isBackupFresh_notRunningAndTuesdayStatus_returnsFalse", () => {
  assert.equal(isBackupFresh(TUESDAY_STATUS, REPORT_AT, false), false);
});

test("isBackupFresh_runningTuesdayStatus_olderThanATwoDayGrace", () => {
  // Le délai de grâce doit dépasser l'écart réel : deux jours (5 j au total) ne suffiraient pas.
  assert.ok(REPORT_AT - Date.parse(TUESDAY_STATUS.date) > STALE_AFTER_MS + 2 * 24 * HOUR);
  assert.ok(RUNNING_GRACE_MS >= 3 * 24 * HOUR);
});

test("isBackupFresh_runningBeyondGrace_returnsFalse", () => {
  assert.equal(isBackupFresh(okStatusAged(STALE_AFTER_MS + RUNNING_GRACE_MS), REPORT_AT, true), false);
});

test("formatBackupStatus_freshOnlyThanksToRunning_mentionsRunningBackup", () => {
  const line = formatBackupStatus(TUESDAY_STATUS, REPORT_AT, Date.parse("2026-11-08T22:49:00Z"));

  assert.match(line, /^☁️ /);
  assert.match(line, /Sauvegarde suivante en cours depuis le 2026-11-08 à 22:49 \(UTC\)\./);
});

test("formatBackupStatus_freshWithoutNeedOfRunning_noRunningMention", () => {
  const line = formatBackupStatus(okStatusAged(HOUR), REPORT_AT, Date.parse("2026-11-09T02:00:00Z"));

  assert.doesNotMatch(line, /en cours/);
});

test("readRunningSince_lineWithDeadPid_returnsNull", async () => {
  // Exécution tuée sans repasser par sa sortie : sa ligne reste, son PID ne tourne plus.
  const file = await withRunningMarker("2026-11-08T22:49:00+00:00 4242\n");

  assert.equal(await readRunningSince(file, REPORT_AT, () => false), null);
});

test("readRunningSince_deadAndAliveLines_returnsAliveStart", async () => {
  const file = await withRunningMarker("2026-11-08T22:49:00+00:00 4242\n2026-11-09T00:30:00+00:00 5151\n");

  const since = await readRunningSince(file, REPORT_AT, (pid) => pid === 5151);

  assert.equal(since, Date.parse("2026-11-09T00:30:00Z"));
});

test("isProcessAlive_currentProcess_returnsTrue", () => {
  assert.equal(isProcessAlive(process.pid), true);
});

test("isProcessAlive_unknownPid_returnsFalse", () => {
  assert.equal(isProcessAlive(2_147_483_646), false);
});
