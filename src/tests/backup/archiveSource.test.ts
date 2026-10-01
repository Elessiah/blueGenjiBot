import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  archiveSourcesFromEnv,
  COMMAND_DIRS,
  COMMAND_PATH,
  commandEnv,
  compareNewestFirst,
  execCommand,
  fetchArchive,
  findMissingCommand,
  MissingCommandError,
  filterArchiveNames,
  listArchives,
  pickArchive,
  resolveCommand,
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
  assert.deepEqual(
    archiveSourcesFromEnv({ BACKUP_ARCHIVE_DIR: "~/archives", BACKUP_AGE_IDENTITY: "~/.bluegenji-backup.key" }),
    {
      localDir: path.join(os.homedir(), "archives"),
      remote: null,
      identity: path.join(os.homedir(), ".bluegenji-backup.key"),
    },
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

test("compareNewestFirst range les archives de la plus récente à la plus ancienne, années et mois compris", () => {
  const names = [
    "bluegenji-2025-12-31.tar.age",
    "bluegenji-2026-10-01.tar.age",
    "bluegenji-2026-09-30.tar.age",
    "bluegenji-2026-01-02.tar.age",
  ];
  assert.deepEqual([...names].sort(compareNewestFirst), [
    "bluegenji-2026-10-01.tar.age",
    "bluegenji-2026-09-30.tar.age",
    "bluegenji-2026-01-02.tar.age",
    "bluegenji-2025-12-31.tar.age",
  ]);
  assert.equal(compareNewestFirst("bluegenji-2026-10-01.tar.age", "bluegenji-2026-10-01.tar.age"), 0);
});

test("filterArchiveNames met la dernière archive en tête quel que soit l'ordre du listage", () => {
  const listed = ["bluegenji-2026-09-09.tar.age", "bluegenji-2026-10-01.tar.age", "bluegenji-2026-09-10.tar.age"];
  assert.equal(filterArchiveNames(listed)[0], "bluegenji-2026-10-01.tar.age");
  assert.equal(filterArchiveNames([...listed].reverse())[0], "bluegenji-2026-10-01.tar.age");
});

test("listArchives rend l'archive la plus récente en premier, toutes sources confondues", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-archives-order-"));
  try {
    fs.writeFileSync(path.join(dir, "bluegenji-2026-09-30.tar.age"), "");
    const run: CommandRunner = async () => "bluegenji-2026-10-01.tar.age\nbluegenji-2026-09-29.tar.age\n";
    const { archives } = await listArchives({ localDir: dir, remote: "r:b", identity: "/k" }, run);
    assert.deepEqual(
      archives.map((archive) => archive.name),
      ["bluegenji-2026-10-01.tar.age", "bluegenji-2026-09-30.tar.age", "bluegenji-2026-09-29.tar.age"],
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("resolveCommand ne cherche une commande que dans les dossiers figés, dans leur ordre", () => {
  const present = new Set(["/usr/bin/age", "/usr/local/bin/rclone", "/usr/bin/rclone"]);
  const canRun = (file: string): boolean => present.has(file);
  assert.equal(resolveCommand("age", COMMAND_DIRS, canRun), "/usr/bin/age");
  assert.equal(resolveCommand("rclone", COMMAND_DIRS, canRun), "/usr/local/bin/rclone");
});

test("resolveCommand rend un chemin absolu même pour une commande absente, jamais un nom nu", () => {
  assert.equal(resolveCommand("tar", COMMAND_DIRS, () => false), "/usr/local/bin/tar");
});

test("resolveCommand refuse tout ce qui n'est pas un nom nu", () => {
  for (const name of ["../age", "/tmp/age", "./age", "age;rm", "-age", ""]) {
    assert.throws(() => resolveCommand(name, COMMAND_DIRS, () => true), /nom de commande invalide/, name);
  }
});

test("commandEnv fige le PATH et garde le reste de l'environnement", () => {
  const env = commandEnv({ PATH: "/home/bot/.local/bin:.:/usr/bin", HOME: "/home/bot" });
  assert.equal(env.PATH, COMMAND_PATH);
  assert.equal(env.PATH, "/usr/local/bin:/usr/bin:/bin");
  assert.equal(env.HOME, "/home/bot");
});

test("execCommand traduit un binaire absent en MissingCommandError, sans chemin dans le message", async () => {
  await assert.rejects(execCommand("bluegenji-binaire-inexistant", []), (error: unknown) => {
    assert.ok(error instanceof MissingCommandError);
    assert.equal(error.command, "bluegenji-binaire-inexistant");
    // Le message part sur Discord (`/restore-backup`, salon de logs) : aucun chemin.
    assert.equal(
      error.message,
      "`bluegenji-binaire-inexistant` introuvable dans les dossiers système où le bot le cherche",
    );
    assert.doesNotMatch(error.message, /\//);
    return true;
  });
});

test("listArchives garde la commande manquante en cause et dans son message", async () => {
  const run: CommandRunner = async () => {
    throw new MissingCommandError("rclone");
  };
  await assert.rejects(listArchives({ localDir: null, remote: "r:b", identity: "/k" }, run), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /^stockage distant : `rclone` introuvable dans les dossiers système/);
    assert.equal(findMissingCommand(error), "rclone");
    return true;
  });
});

test("findMissingCommand ne voit rien dans un échec ordinaire", () => {
  assert.equal(findMissingCommand(new Error("dial tcp", { cause: new Error("ECONNREFUSED") })), null);
  assert.equal(findMissingCommand("pas une erreur"), null);
  assert.equal(findMissingCommand(new MissingCommandError("age")), "age");
});

test("listArchives signale la commande manquante même quand l'autre source répond", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-archives-missing-"));
  try {
    fs.writeFileSync(path.join(dir, "bluegenji-2026-09-30.tar.age"), "");
    const run: CommandRunner = async () => {
      throw new MissingCommandError("rclone");
    };
    const listing = await listArchives({ localDir: dir, remote: "r:b", identity: "/k" }, run);
    assert.equal(listing.missingCommand, "rclone");
    assert.equal(listing.archives.length, 1);
    assert.equal(listing.failures.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
