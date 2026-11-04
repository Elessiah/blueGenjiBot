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
  assert.match(BACKUP_SCRIPT, />> "\$STATUS_HISTORY_FILE"/);
  assert.match(BACKUP_SCRIPT, /mkdir -p "\$\(dirname "\$STATUS_FILE"\)" "\$\(dirname "\$STATUS_HISTORY_FILE"\)"/);
  assert.match(BACKUP_SCRIPT, /tail -n "\$STATUS_HISTORY_LINES"/);
});

test("backupScript_writeStatus_historyUpdatedUnderFlock", () => {
  // Lancement manuel pendant le cron : l'ajout puis l'élagage forment un tout.
  const write = BACKUP_SCRIPT.slice(BACKUP_SCRIPT.indexOf("write_status() {"), BACKUP_SCRIPT.indexOf("\nfail() {"));
  assert.match(write, /\(\n\s+if command -v flock >\/dev\/null 2>&1; then\n\s+flock -w 30 8 \|\| exit 1\n\s+fi\n\s+printf [^\n]+>> "\$STATUS_HISTORY_FILE"/);
  assert.match(write, /mv "\$STATUS_HISTORY_FILE\.tmp\.\$\$" "\$STATUS_HISTORY_FILE"\n\s+\) 8>"\$STATUS_HISTORY_FILE\.lock"/);
});

test("backupScript_writeStatus_overlappingRuns_noLineLost", { skip: !hasBashWithFlock() && "bash ou flock absent" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-history-lock-"));
  try {
    const write = BACKUP_SCRIPT.slice(BACKUP_SCRIPT.indexOf("write_status() {"), BACKUP_SCRIPT.indexOf("\nfail() {"));
    const script = [
      `STATUS_FILE="${dir}/status.json"`,
      `STATUS_HISTORY_FILE="${dir}/status-history.jsonl"`,
      "STATUS_HISTORY_LINES=100 STATUS_OK=true STATUS_ERROR= STATUS_SIZE=0 STATUS_PARTS= RCLONE_REMOTE=r REMOTE_DIR=d STAMP=s",
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
