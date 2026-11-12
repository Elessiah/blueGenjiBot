import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import { spawnSync } from "node:child_process";

/**
 * Le miroir horaire des images (`scripts/sync-uploads-onedrive.sh`) porte aussi
 * la quarantaine des logos du site. Ce test garde, sur la source, le seul geste
 * du script qui peut détruire une sauvegarde sans rien avoir à copier.
 */
const SCRIPT = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "sync-uploads-onedrive.sh"),
  "utf8",
);
const BACKUP_SCRIPT = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "backup-onedrive.sh"),
  "utf8",
);

/** `bash` et `flock` présents (Linux de la CI et du Raspberry ; absents sous Git Bash). */
function hasBashWithFlock(): boolean {
  return spawnSync("bash", ["-c", "command -v flock"], { encoding: "utf8" }).status === 0;
}

test("la quarantaine n'est synchronisée que si son dossier local existe", () => {
  assert.match(SCRIPT, /if \[\[ -d "\$QUARANTINE_DIR" \]\]; then\s+rclone sync "\$QUARANTINE_DIR" "\$QUARANTINE_DEST"/);
});

test("un dossier de quarantaine absent ne purge jamais la copie distante", () => {
  // Machine reconstruite avant la restauration : purger effacerait la seule
  // copie des logos en attente de contestation au premier passage horaire.
  assert.doesNotMatch(SCRIPT, /rclone (purge|delete)[^\n]*QUARANTINE_DEST/);
});

test("un remote non chiffré est refusé, sans réglage pour passer outre", () => {
  // Un avatar est une donnée personnelle : aucune variable ne doit rouvrir
  // l'envoi en clair vers le stockage distant.
  assert.match(SCRIPT, /if \[\[ "\$REMOTE_TYPE" != "crypt" \]\]; then\s+die /);
  assert.doesNotMatch(SCRIPT, /PLAINTEXT/);
});

test("le contrôle du chiffrement précède tout envoi", () => {
  const check = SCRIPT.indexOf('if [[ "$REMOTE_TYPE" != "crypt" ]]');
  const firstUpload = SCRIPT.search(/^\s*rclone (sync|copy|copyto) /m);
  assert.ok(check > 0 && firstUpload > check);
});

test("la purge horaire des archives tourne même si le remote des images est refusé", () => {
  // Sans elle, une archive vivrait jusqu'à 35 jours (purge des seules sauvegardes du dimanche et du mardi)
  // au lieu des RETENTION_DAYS annoncés par le site.
  const purge = SCRIPT.search(/^rclone delete "\$RCLONE_REMOTE:\$REMOTE_DIR"/m);
  assert.ok(purge > 0);
  // Seuls les prérequis de la purge l'arrêtent : binaires, configuration lue,
  // verrou. Aucun contrôle propre au miroir des images ne la précède.
  const guardsBefore = SCRIPT.slice(0, purge).split("\n").filter((line) => /\bdie "/.test(line));
  assert.deepEqual(guardsBefore.map((line) => line.trim()), [
    '[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || die "RETENTION_DAYS invalide ($RETENTION_DAYS) : un nombre de jours, au moins 1"',
    'command -v "$binary" >/dev/null 2>&1 || die "binaire manquant : $binary"',
    '[[ -n "$UPLOADS_DIR" ]] || die "UPLOADS_DIR non renseigné dans $CONFIG_FILE"',
    'flock -w 600 9 || die "une autre synchronisation tient le verrou depuis plus de 10 min"',
  ]);
});

test("le seuil des purges est trois heures sous RETENTION_DAYS jours (EF-05, EF-14)", () => {
  // La purge horaire passe à :17 et peut attendre le verrou d'une longue sauvegarde
  // du dimanche : une heure de marge laissait l'archive d'il y a 30 jours dépasser
  // la borne de quelques minutes, trois la gardent sous les 30 jours.
  const threshold = /--min-age "\$\(\(RETENTION_DAYS \* 24 - PURGE_MARGIN_HOURS\)\)h" --include "bluegenji-\*\.tar\.age"/;
  for (const source of [SCRIPT, BACKUP_SCRIPT]) {
    assert.match(source, threshold);
    assert.match(source, /^PURGE_MARGIN_HOURS=3$/m);
    assert.doesNotMatch(source, /--min-age "\$\{RETENTION_DAYS\}d"/);
  }
});

test("scripts_retentionDaysValidated_beforePurge", () => {
  // 0 ou une valeur négative donnerait un seuil négatif : toutes les archives effacées.
  const cases: Array<[string, string]> = [[SCRIPT, "die"], [BACKUP_SCRIPT, "fail"]];
  for (const [source, stop] of cases) {
    const guard = source.indexOf(`[[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]] || ${stop} `);
    const purge = source.search(/^rclone delete "\$RCLONE_REMOTE:\$REMOTE_DIR"/m);
    assert.ok(guard > 0 && guard < purge, stop);
  }
});

test("backupScript_writeStatus_appendsToHistory", () => {
  assert.match(BACKUP_SCRIPT, /: "\$\{STATUS_HISTORY_FILE:=\$\{STATUS_FILE%\.json\}-history\.jsonl\}"/);
  assert.match(BACKUP_SCRIPT, /mv -f -T "\$tmp" "\$STATUS_HISTORY_FILE"/);
  assert.match(BACKUP_SCRIPT, /mkdir -p "\$\(dirname "\$STATUS_FILE"\)" "\$\(dirname "\$STATUS_HISTORY_FILE"\)"/);
  assert.match(BACKUP_SCRIPT, /tail -n "\$\(\(STATUS_HISTORY_LINES - 1\)\)"/);
});

test("backupScript_writeStatus_historyUpdatedUnderFlock", () => {
  // Lancement manuel pendant le cron : l'ajout puis l'élagage forment un tout.
  const write = BACKUP_SCRIPT.slice(BACKUP_SCRIPT.indexOf("write_status() {"), BACKUP_SCRIPT.indexOf("\nfail() {"));
  assert.match(write, /\(\n\s+if command -v flock >\/dev\/null 2>&1; then\n\s+flock -w 30 8 \|\| exit 1\n\s+fi\n/);
  assert.match(write, /mv -f -T "\$tmp" "\$STATUS_HISTORY_FILE" \|\| \{ rm -f "\$tmp"; exit 1; \}\n\s+\) 8<"\$\(dirname "\$STATUS_HISTORY_FILE"\)"/);
  // Jamais `>` ni `>>` sur l'historique ou le statut eux-mêmes : un lien posé à leur place serait suivi.
  assert.doesNotMatch(write, />>? "\$STATUS_HISTORY_FILE"/);
  assert.doesNotMatch(write, /> "\$STATUS_FILE"/);
});

/** Fonction `sibling_tmp` du script, nécessaire à `write_status` jouée seule. */
function siblingTmpFunction(): string {
  const start = BACKUP_SCRIPT.indexOf("sibling_tmp() {");
  const end = BACKUP_SCRIPT.indexOf("\n}\n", start);
  assert.ok(start > 0 && end > start, "sibling_tmp introuvable");
  return BACKUP_SCRIPT.slice(start, end + 2);
}

/** Joue `write_status` seule (`count` fois de suite) dans `dir` ; rend le statut de bash. */
function runWriteStatus(dir: string, count: number, lines = 100): { status: number | null; stderr: string } {
  const write = BACKUP_SCRIPT.slice(BACKUP_SCRIPT.indexOf("write_status() {"), BACKUP_SCRIPT.indexOf("\nfail() {"));
  const script = [
    `STATUS_FILE="${dir}/status.json"`,
    `STATUS_HISTORY_FILE="${dir}/status-history.jsonl"`,
    `STATUS_HISTORY_LINES=${lines} STATUS_OK=false STATUS_ERROR=boom STATUS_SIZE=0 STATUS_PARTS= RCLONE_REMOTE=r REMOTE_DIR=d STAMP=s STATUS_HISTORY_JSON=`,
    siblingTmpFunction(),
    write,
    `for i in $(seq 1 ${count}); do write_status; done`,
  ].join("\n");
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 30_000 });
  return { status: result.status, stderr: result.stderr };
}

const BASH_PRESENT = spawnSync("bash", ["-c", "true"]).status === 0;

test("backupScript_writeStatus_historyPrunedToLimit_noTempLeft", { skip: !BASH_PRESENT && "bash absent" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-history-prune-")).split(path.sep).join("/");
  try {
    const { status, stderr } = runWriteStatus(dir, 5, 3);
    assert.equal(status, 0, stderr);
    const lines = fs.readFileSync(path.join(dir, "status-history.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 3);
    assert.equal((JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8")) as { error: string }).error, "boom");
    assert.deepEqual(fs.readdirSync(dir).sort(), ["status-history.jsonl", "status.json"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("backupScript_writeStatus_symlinkedHistory_replacedNotFollowed", { skip: !BASH_PRESENT && "bash absent" }, (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-history-link-")).split(path.sep).join("/");
  try {
    const victim = path.join(dir, "victim.txt");
    fs.writeFileSync(victim, "intact\n");
    try {
      fs.symlinkSync(victim, path.join(dir, "status-history.jsonl"));
    } catch {
      t.skip("liens symboliques indisponibles");
      return;
    }
    const { status, stderr } = runWriteStatus(dir, 1);
    assert.equal(status, 0, stderr);
    assert.equal(fs.readFileSync(victim, "utf8"), "intact\n");
    assert.equal(fs.lstatSync(path.join(dir, "status-history.jsonl")).isSymbolicLink(), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("backupScript_writeStatus_overlappingRuns_noLineLost", { skip: !hasBashWithFlock() && "bash ou flock absent" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-history-lock-"));
  try {
    const write = BACKUP_SCRIPT.slice(BACKUP_SCRIPT.indexOf("write_status() {"), BACKUP_SCRIPT.indexOf("\nfail() {"));
    const script = [
      `STATUS_FILE="${dir}/status.json"`,
      `STATUS_HISTORY_FILE="${dir}/status-history.jsonl"`,
      "STATUS_HISTORY_LINES=100 STATUS_OK=true STATUS_ERROR= STATUS_SIZE=0 STATUS_PARTS= RCLONE_REMOTE=r REMOTE_DIR=d STAMP=s",
      siblingTmpFunction(),
      write,
      "for i in 1 2 3 4 5 6 7 8 9 10; do write_status & done; wait",
    ].join("\n");
    const result = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr);
    const lines = fs.readFileSync(path.join(dir, "status-history.jsonl"), "utf8").trim().split("\n");
    assert.equal(lines.length, 10);
    assert.deepEqual(lines.map((line) => (JSON.parse(line) as { ok: boolean }).ok), Array(10).fill(true));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("la purge des archives n'est jamais lancée sur une configuration non lue", () => {
  const purge = SCRIPT.search(/^rclone delete "\$RCLONE_REMOTE:\$REMOTE_DIR"/m);
  const configCheck = SCRIPT.indexOf('[[ -n "$UPLOADS_DIR" ]] || die');
  const lock = SCRIPT.indexOf("flock -w 600 9");
  assert.ok(configCheck > 0 && configCheck < purge);
  assert.ok(lock > 0 && lock < purge);
});

test("backupScript_fail_controlCharactersStrippedFromError", { skip: spawnSync("bash", ["-c", "true"]).status !== 0 && "bash absent" }, () => {
  // Une tabulation ou un retour chariot (sortie rclone) rendait la ligne
  // d'historique illisible : l'échec disparaissait du rapport du lundi.
  const sanitize = BACKUP_SCRIPT.match(/^ {2}STATUS_ERROR="\$\(printf '%s' "\$1" \| [^\n]+$/m);
  assert.ok(sanitize);
  // Citation ANSI-C : mêmes octets sous Git Bash et sous Ubuntu (printf y diffère).
  const script = `set -- $'a\\tb\\rc\\nd"e\\\\h\\x0cf\\x01g'\n${sanitize[0]}\nprintf '{"error":"%s"}' "$STATUS_ERROR"`;
  const result = spawnSync("bash", ["-c", script], { encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { error: "a b c dehfg" });
});

/**
 * Fonctions du marqueur de sauvegarde en cours, tirées du script et jouées sous
 * `bash` dans un dossier temporaire (sans `flock` sous Git Bash : le verrou est
 * alors sauté, le reste est le même).
 */
function runMarkerSteps(steps: string): { status: number | null; marker: string | null; files: string[] } {
  const start = BACKUP_SCRIPT.indexOf('RUNNING_FILE="$STATUS_FILE.running"');
  const end = BACKUP_SCRIPT.indexOf("trap '", start);
  assert.ok(start > 0 && end > start, "fonctions du marqueur introuvables");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-running-"));
  try {
    const statusFile = path.join(dir, "status.json").split(path.sep).join("/");
    const script = `set -euo pipefail\nSTATUS_FILE='${statusFile}'\n${BACKUP_SCRIPT.slice(start, end)}\n${steps}\n`;
    const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
    const markerPath = path.join(dir, "status.json.running");
    return {
      status: result.status,
      marker: fs.existsSync(markerPath) ? fs.readFileSync(markerPath, "utf8") : null,
      files: fs.readdirSync(dir),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const HAS_BASH = spawnSync("bash", ["-c", "command -v grep"], { encoding: "utf8" }).status === 0;

test("backupRunningMarker_laterRunEndsFirst_keepsTheEarlierRunLine", { skip: !HAS_BASH && "bash absent" }, () => {
  // Cron parti à 23 h 49, lancement manuel à 23 h 55 fini avant lui : la ligne du cron reste.
  const { status, marker } = runMarkerSteps([
    'RUNNING_LINE="2026-11-08T23:49:00+01:00 $$"; add_running_line',
    'RUNNING_LINE="2026-11-08T23:55:00+01:00 $$"; add_running_line',
    "release_running_marker",
  ].join("\n"));

  assert.equal(status, 0);
  assert.match(marker ?? "", /^2026-11-08T23:49:00\+01:00 \d+\n$/);
});

test("backupRunningMarker_earlierRunEndsFirst_keepsTheLaterRunLine", { skip: !HAS_BASH && "bash absent" }, () => {
  const { status, marker } = runMarkerSteps([
    'RUNNING_LINE="2026-11-08T23:40:00+01:00 $$"; add_running_line',
    'RUNNING_LINE="2026-11-08T23:49:00+01:00 $$"; add_running_line',
    'RUNNING_LINE="2026-11-08T23:40:00+01:00 $$"; release_running_marker',
  ].join("\n"));

  assert.equal(status, 0);
  assert.match(marker ?? "", /^2026-11-08T23:49:00\+01:00 \d+\n$/);
});

test("backupRunningMarker_lastRunEnds_removesTheMarker", { skip: !HAS_BASH && "bash absent" }, () => {
  const { status, marker } = runMarkerSteps("add_running_line\nrelease_running_marker");

  assert.equal(status, 0);
  assert.equal(marker, null);
});

test("backupRunningMarker_releaseWithoutMarker_succeeds", { skip: !HAS_BASH && "bash absent" }, () => {
  const { status, marker } = runMarkerSteps("release_running_marker");

  assert.equal(status, 0);
  assert.equal(marker, null);
});

test("backupRunningMarker_deadPidLine_prunedOnAdd", { skip: !HAS_BASH && "bash absent" }, () => {
  // Cron tué (manque de mémoire) sans repasser par sa sortie : la ligne de son PID mort part
  // au lancement suivant, qui n'efface jamais la ligne d'une exécution vivante.
  const { status, marker } = runMarkerSteps([
    `printf '2026-11-08T23:49:00+01:00 2147483646\n2026-11-08T23:50:00+01:00 %s\n' "$$" > "$RUNNING_FILE"`,
    'RUNNING_LINE="2026-11-09T01:00:00+01:00 $$"; add_running_line',
  ].join("\n"));

  assert.equal(status, 0);
  assert.match(marker ?? "", /^2026-11-08T23:50:00\+01:00 \d+\n2026-11-09T01:00:00\+01:00 \d+\n$/);
});

test("backupRunningMarker_recentLineWithoutPid_keptOnAdd", { skip: !HAS_BASH && "bash absent" }, () => {
  // Ligne d'un script antérieur (date seule) encore récente : elle reste.
  const { status, marker } = runMarkerSteps([
    `RECENT="$(date --iso-8601=seconds)"; printf '%s\n' "$RECENT" > "$RUNNING_FILE"`,
    'RUNNING_LINE="2026-11-09T01:00:00+01:00 $$"; add_running_line',
  ].join("\n"));

  assert.equal(status, 0);
  assert.match(marker ?? "", /^\d{4}-\d\d-\d\dT[^ \n]+\n2026-11-09T01:00:00\+01:00 \d+\n$/);
});

test("backupRunningMarker_oldOrMalformedLine_prunedOnAdd", { skip: !HAS_BASH && "bash absent" }, () => {
  // Une ligne sans PID de plus de douze heures, ou illisible, ne reste pas pour toujours.
  const { status, marker } = runMarkerSteps([
    `printf '2020-01-01T00:00:00+01:00\npas une date\n2026-11-08T23:49:00+01:00 abc\n' > "$RUNNING_FILE"`,
    'RUNNING_LINE="2026-11-09T01:00:00+01:00 $$"; add_running_line',
  ].join("\n"));

  assert.equal(status, 0);
  assert.match(marker ?? "", /^2026-11-09T01:00:00\+01:00 \d+\n$/);
});

test("backupRunningMarker_symlinkedMarker_replacedNotFollowed", { skip: !HAS_BASH && "bash absent" }, () => {
  // Un lien posé à la place du marqueur n'est jamais suivi : sa cible reste intacte.
  const { status, marker, files } = runMarkerSteps([
    `printf 'intact\n' > "$RUNNING_FILE.victim"`,
    `ln -s "$RUNNING_FILE.victim" "$RUNNING_FILE" 2>/dev/null || cp "$RUNNING_FILE.victim" "$RUNNING_FILE"`,
    'RUNNING_LINE="2026-11-09T01:00:00+01:00 $$"; add_running_line',
    `[[ "$(cat "$RUNNING_FILE.victim")" == intact ]]`,
  ].join("\n"));

  assert.equal(status, 0);
  assert.match(marker ?? "", /2026-11-09T01:00:00\+01:00 \d+\n$/);
  assert.deepEqual(files.filter((name) => name.includes(".tmp.")), []);
});

test("backupRunningMarker_release_leavesNoLockFile", { skip: !HAS_BASH && "bash absent" }, () => {
  const { status, files } = runMarkerSteps("add_running_line\nrelease_running_marker");

  assert.equal(status, 0);
  assert.deepEqual(files, []);
});

test("backupRunningMarker_releaseWithSymlinkedMarker_removesLinkKeepsTarget", { skip: !HAS_BASH && "bash absent" }, (t) => {
  const { status, marker, files } = runMarkerSteps([
    `printf 'intact' > "$RUNNING_FILE.victim"`,
    // Git Bash copie au lieu de lier : sans vrai lien, rien à prouver ici.
    `ln -s "$RUNNING_FILE.victim" "$RUNNING_FILE" && [[ -L "$RUNNING_FILE" ]] || exit 3`,
    "release_running_marker",
    `[[ "$(cat "$RUNNING_FILE.victim")" == intact ]]`,
  ].join(String.fromCharCode(10)));
  if (status === 3) { t.skip("liens symboliques indisponibles"); return; }

  assert.equal(status, 0);
  assert.equal(marker, null);
  assert.deepEqual(files, ["status.json.running.victim"]);
});
