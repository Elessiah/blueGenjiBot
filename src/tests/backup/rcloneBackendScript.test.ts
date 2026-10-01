import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * `scripts/rclone-backend.sh` décide quelles options de suppression définitive
 * passer au stockage distant : `--onedrive-*` seulement quand le remote — à
 * travers son enveloppe `crypt` — mène à OneDrive. Testé en exécutant le vrai
 * script contre un faux `rclone` placé en tête du PATH.
 */
const SCRIPTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "scripts");
const HELPER = path.join(SCRIPTS_DIR, "rclone-backend.sh");

// Sous Windows, `bash` peut désigner WSL, qui ne voit ni ce PATH ni ces
// chemins : le comportement est vérifié sur la CI (Linux).
const skip = process.platform === "win32" ? "bash non portable sous Windows" : false;

const FAKE_RCLONE = `#!/usr/bin/env bash
case "$1" in
  listremotes) cat "$FAKE_RCLONE_DIR/remotes.txt" ;;
  config) cat "$FAKE_RCLONE_DIR/show-$3.txt" 2>/dev/null ;;
esac
`;

function flagsFor(remote: string, remotes: string, shows: Record<string, string> = {}): string[] {
  return run(remote, remotes, shows).flags;
}

function run(
  remote: string,
  remotes: string,
  shows: Record<string, string> = {},
): { flags: string[]; stderr: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rclone-backend-"));
  try {
    fs.writeFileSync(path.join(dir, "rclone"), FAKE_RCLONE, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "remotes.txt"), remotes);
    for (const [name, content] of Object.entries(shows)) {
      fs.writeFileSync(path.join(dir, `show-${name}.txt`), content);
    }
    const result = spawnSync("bash", ["-c", `source "$1"; provider_delete_flags "$2"`, "bash", HELPER, remote], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, FAKE_RCLONE_DIR: dir },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return { flags: result.stdout.split("\n").filter(Boolean), stderr: result.stderr };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const ONEDRIVE_FLAGS = ["--onedrive-hard-delete", "--onedrive-no-versions"];

test("un remote OneDrive reçoit les options de suppression définitive", { skip }, () => {
  assert.deepEqual(flagsFor("onedrive", "onedrive: onedrive\n"), ONEDRIVE_FLAGS);
});

test("un remote crypt enveloppant OneDrive les reçoit aussi", { skip }, () => {
  const flags = flagsFor("onedrive-crypt", "onedrive: onedrive\nonedrive-crypt: crypt\n", {
    "onedrive-crypt": "[onedrive-crypt]\ntype = crypt\nremote = onedrive:BlueGenji/crypt\n",
  });
  assert.deepEqual(flags, ONEDRIVE_FLAGS);
});

test("un remote WebDAV (Nextcloud) ne reçoit aucune option OneDrive", { skip }, () => {
  assert.deepEqual(flagsFor("storage", "storage: webdav\n"), []);
});

test("un crypt enveloppant un WebDAV ne reçoit aucune option OneDrive", { skip }, () => {
  const flags = flagsFor("storage-crypt", "storage: webdav\nstorage-crypt: crypt\n", {
    "storage-crypt": "[storage-crypt]\ntype = crypt\nremote = storage:BlueGenji\n",
  });
  assert.deepEqual(flags, []);
});

test("un crypt sur dossier local ou un remote inconnu ne reçoit rien", { skip }, () => {
  assert.deepEqual(
    flagsFor("local-crypt", "local-crypt: crypt\n", { "local-crypt": "remote = /srv/backup\n" }),
    [],
  );
  assert.deepEqual(flagsFor("absent", "onedrive: onedrive\n"), []);
});

test("un fournisseur non identifié est signalé, jamais passé sous silence", { skip }, () => {
  // Un OneDrive que la détection ne reconnaît pas enverrait ses suppressions à
  // la corbeille : l'avertissement est la seule trace dans le journal du cron.
  const unknown = run("absent", "onedrive: onedrive\n");
  assert.deepEqual(unknown.flags, []);
  assert.match(unknown.stderr, /AVERTISSEMENT : fournisseur du remote absent non identifié/);
  assert.equal(run("storage", "storage: webdav\n").stderr, "");
});

test("les deux scripts passent par la détection, sans option OneDrive écrite en dur", () => {
  for (const name of ["backup-onedrive.sh", "sync-uploads-onedrive.sh"]) {
    const script = fs.readFileSync(path.join(SCRIPTS_DIR, name), "utf8");
    assert.match(script, /source "\$SCRIPT_DIR\/rclone-backend\.sh"/);
    assert.match(script, /provider_delete_flags "\$RCLONE_REMOTE"/);
    // Hors des commentaires, aucune option `--onedrive-*` n'est posée d'office.
    const code = script.split("\n").filter((line) => !line.trim().startsWith("#")).join("\n");
    assert.doesNotMatch(code, /--onedrive-/);
  }
});
