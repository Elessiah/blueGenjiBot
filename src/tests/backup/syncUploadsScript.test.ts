import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Le miroir horaire des images (`scripts/sync-uploads-onedrive.sh`) porte aussi
 * la quarantaine des logos du site. Ce test garde, sur la source, le seul geste
 * du script qui peut détruire une sauvegarde sans rien avoir à copier.
 */
const SCRIPT = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts", "sync-uploads-onedrive.sh"),
  "utf8",
);

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
  // Sans elle, une archive vivrait jusqu'à 35 jours (purge du lundi seule)
  // au lieu des RETENTION_DAYS annoncés par le site.
  const purge = SCRIPT.search(/^rclone delete "\$RCLONE_REMOTE:\$REMOTE_DIR"/m);
  assert.ok(purge > 0);
  // Seuls les prérequis de la purge l'arrêtent : binaires, configuration lue,
  // verrou. Aucun contrôle propre au miroir des images ne la précède.
  const guardsBefore = SCRIPT.slice(0, purge).split("\n").filter((line) => /\bdie "/.test(line));
  assert.deepEqual(guardsBefore.map((line) => line.trim()), [
    'command -v "$binary" >/dev/null 2>&1 || die "binaire manquant : $binary"',
    '[[ -n "$UPLOADS_DIR" ]] || die "UPLOADS_DIR non renseigné dans $CONFIG_FILE"',
    'flock -w 600 9 || die "une autre synchronisation tient le verrou depuis plus de 10 min"',
  ]);
});

test("la purge des archives n'est jamais lancée sur une configuration non lue", () => {
  const purge = SCRIPT.search(/^rclone delete "\$RCLONE_REMOTE:\$REMOTE_DIR"/m);
  const configCheck = SCRIPT.indexOf('[[ -n "$UPLOADS_DIR" ]] || die');
  const lock = SCRIPT.indexOf("flock -w 600 9");
  assert.ok(configCheck > 0 && configCheck < purge);
  assert.ok(lock > 0 && lock < purge);
});
