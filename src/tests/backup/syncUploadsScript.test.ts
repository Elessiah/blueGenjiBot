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
  // l'envoi en clair vers un OneDrive personnel.
  assert.match(SCRIPT, /if \[\[ "\$REMOTE_TYPE" != "crypt" \]\]; then\s+die /);
  assert.doesNotMatch(SCRIPT, /PLAINTEXT/);
});

test("le contrôle du chiffrement précède tout envoi", () => {
  const check = SCRIPT.indexOf('if [[ "$REMOTE_TYPE" != "crypt" ]]');
  const firstUpload = SCRIPT.search(/^\s*rclone (sync|copy|copyto) /m);
  assert.ok(check > 0 && firstUpload > check);
});
