import test from "node:test";
import assert from "node:assert/strict";

import { MissingCommandError, missingCommandText } from "../../backup/archiveSource.js";
import { failedSourceLabel, restoreFailureText } from "../../commandsHandlers/admin/restoreBackup.js";

/**
 * `/restore-backup` ne relaie plus sur Discord le message brut de `rclone`,
 * `age` ou `tar` : remote et dossiers distants, dossier temporaire et chemin
 * de la clé restent dans les journaux pm2.
 */

const RAW_RCLONE =
  "Command failed: /usr/bin/rclone copyto onedrive:BlueGenji/backups/bluegenji-2026-09-28.tar.age " +
  "/tmp/bluegenji-restore-AbC123/bluegenji-2026-09-28.tar.age\nERROR : directory not found";

test("restoreFailureText ne rend rien du message brut d'une commande", () => {
  const text = restoreFailureText(new Error(RAW_RCLONE));
  assert.equal(text, "détail dans les journaux pm2");
  assert.doesNotMatch(text, /onedrive|\/tmp|rclone|BlueGenji/);
});

test("restoreFailureText nomme une commande introuvable, sans chemin", () => {
  assert.equal(restoreFailureText(new MissingCommandError("age")), missingCommandText("age"));
  assert.doesNotMatch(restoreFailureText(new MissingCommandError("age")), /\/usr|\/bin/);
});

test("restoreFailureText trouve la commande introuvable dans la chaîne des causes", () => {
  const wrapped = new Error("stockage distant : `rclone` introuvable", { cause: new MissingCommandError("rclone") });
  assert.equal(restoreFailureText(wrapped), missingCommandText("rclone"));
});

test("restoreFailureText accepte une valeur levée qui n'est pas une Error", () => {
  assert.equal(restoreFailureText("/home/bot/.bluegenji-backup.key: permission denied"), "détail dans les journaux pm2");
  assert.equal(restoreFailureText(null), "détail dans les journaux pm2");
  assert.equal(restoreFailureText(undefined), "détail dans les journaux pm2");
});

test("failedSourceLabel ne garde que le nom de la source", () => {
  assert.equal(failedSourceLabel(`stockage distant : ${RAW_RCLONE}`), "stockage distant");
  assert.equal(failedSourceLabel("dossier local : ENOENT: no such file or directory, scandir '/srv/archives'"), "dossier local");
});

test("failedSourceLabel replie sur un libellé neutre sans préfixe reconnu", () => {
  assert.equal(failedSourceLabel("ENOENT /srv/archives"), "source");
  assert.equal(failedSourceLabel(" : /srv/archives"), "source");
  assert.equal(failedSourceLabel(""), "source");
});
