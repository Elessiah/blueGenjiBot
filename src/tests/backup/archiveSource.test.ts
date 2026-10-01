import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  archiveSourcesFromEnv,
  fetchArchive,
  filterArchiveNames,
  listArchives,
  pickArchive,
  type ArchiveRef,
  type CommandRunner,
} from "../../backup/archiveSource.js";

test("filterArchiveNames ne garde que les archives chiffrées, de la plus récente à la plus ancienne", () => {
  assert.deepEqual(
    filterArchiveNames([
      "bluegenji-2026-09-01.tar.age",
      "bluegenji-2026-09-03.tar.age\r",
      "bluegenji-2026-09-02.tar",
      "database.sqlite",
      "../bluegenji-2026-09-04.tar.age",
      "bluegenji-2026-09-01.tar.age",
      "",
    ]),
    ["bluegenji-2026-09-03.tar.age", "bluegenji-2026-09-01.tar.age"],
  );
});

test("pickArchive désigne une archive listée par sa date ou son nom, rien d'autre", () => {
  const available: ArchiveRef[] = [
    { name: "bluegenji-2026-09-03.tar.age", location: "remote" },
    { name: "bluegenji-2026-09-01.tar.age", location: "local" },
  ];
  assert.deepEqual(pickArchive(available, "2026-09-03"), available[0]);
  assert.deepEqual(pickArchive(available, " bluegenji-2026-09-01.tar.age "), available[1]);
  assert.equal(pickArchive(available, "2026-09-02"), null);
  assert.equal(pickArchive(available, "../bluegenji-2026-09-01.tar.age"), null);
  assert.equal(pickArchive(available, "--config=/etc/passwd"), null);
});

test("archiveSourcesFromEnv lit les trois réglages, clé par défaut dans le dossier personnel", () => {
  assert.deepEqual(
    archiveSourcesFromEnv({ BACKUP_ARCHIVE_DIR: " /srv/b ", BACKUP_RCLONE_REMOTE: "hetzner:backups", BACKUP_AGE_IDENTITY: "/k" }),
    { localDir: "/srv/b", remote: "hetzner:backups", identity: "/k" },
  );
  const defaults = archiveSourcesFromEnv({});
  assert.equal(defaults.localDir, null);
  assert.equal(defaults.remote, null);
  assert.equal(defaults.identity, path.join(os.homedir(), ".bluegenji-backup.key"));
});

test("listArchives refuse sans aucune source configurée", async () => {
  await assert.rejects(listArchives({ localDir: null, remote: null, identity: "/k" }), /aucune source/);
});

test("listArchives réunit dossier local et remote, la copie locale l'emporte", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-archives-"));
  fs.writeFileSync(path.join(dir, "bluegenji-2026-09-02.tar.age"), "x");
  fs.writeFileSync(path.join(dir, "notes.txt"), "x");
  const calls: string[][] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push([command, ...args]);
    return "bluegenji-2026-09-03.tar.age\nbluegenji-2026-09-02.tar.age\n";
  };
  const { archives, failures } = await listArchives({ localDir: dir, remote: "hetzner:backups", identity: "/k" }, run);
  assert.deepEqual(failures, []);
  assert.deepEqual(archives, [
    { name: "bluegenji-2026-09-03.tar.age", location: "remote" },
    { name: "bluegenji-2026-09-02.tar.age", location: "local" },
  ]);
  assert.deepEqual(calls, [["rclone", "lsf", "hetzner:backups", "--files-only", "--include", "bluegenji-*.tar.age"]]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("listArchives tolère une source en panne tant que l'autre répond, pas les deux", async () => {
  const failing: CommandRunner = async () => {
    throw new Error("remote injoignable");
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-archives-"));
  fs.writeFileSync(path.join(dir, "bluegenji-2026-09-02.tar.age"), "x");
  const partial = await listArchives({ localDir: dir, remote: "r:b", identity: "/k" }, failing);
  assert.equal(partial.archives.length, 1);
  // L'échec du distant est rendu, pas avalé.
  assert.equal(partial.failures.length, 1);
  assert.match(partial.failures[0], /stockage distant : remote injoignable/);
  await assert.rejects(
    listArchives({ localDir: path.join(dir, "absent"), remote: "r:b", identity: "/k" }, failing),
    /remote injoignable.*dossier local/,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("fetchArchive copie une archive locale et télécharge une archive distante", async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-src-"));
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "bluegenji-work-"));
  fs.writeFileSync(path.join(src, "bluegenji-2026-09-02.tar.age"), "chiffre");
  const calls: string[][] = [];
  const run: CommandRunner = async (command, args) => {
    calls.push([command, ...args]);
    return "";
  };
  const sources = { localDir: src, remote: "hetzner:backups", identity: "/k" };

  const local = await fetchArchive(sources, { name: "bluegenji-2026-09-02.tar.age", location: "local" }, work, run);
  assert.equal(fs.readFileSync(local, "utf8"), "chiffre");
  assert.equal(calls.length, 0);

  const remote = await fetchArchive(sources, { name: "bluegenji-2026-09-03.tar.age", location: "remote" }, work, run);
  assert.equal(remote, path.join(work, "bluegenji-2026-09-03.tar.age"));
  assert.deepEqual(calls, [["rclone", "copyto", "hetzner:backups/bluegenji-2026-09-03.tar.age", remote]]);
  fs.rmSync(src, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});
