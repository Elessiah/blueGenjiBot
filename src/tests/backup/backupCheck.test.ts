import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  backupCheckConfigFromEnv,
  backupChecksPassed,
  checkLatestArchive,
  checkRecipientKey,
  checkUploadsMirror,
  formatBackupChecks,
  parseEnvFile,
  parseRecipients,
  parseTarListing,
  runPipeline,
  type BackupCheckConfig,
  type SpawnFn,
} from "../../backup/backupCheck.js";
import { answerBackupCheck } from "../../commandsHandlers/admin/backupCheck.js";
import type { CommandRunner } from "../../backup/archiveSource.js";

const KEY = "age1qyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqszqgpqyqs3290gq";

/**
 * Faux binaires : chaque commande devient un petit script Node qui lit stdin
 * et écrit stdout, si bien que le tube est **réel** (processus, tubes,
 * codes de sortie) sans `age`, `rclone` ni `tar` installés.
 * - `rclone cat` écrit « ENC: » suivi du nom de l'archive ;
 * - `age` exige ce préfixe (sinon sort en 1, comme une mauvaise clé) ;
 * - `tar -t` écrit la liste voulue.
 */
function fakeSpawn(options: { tarEntries?: string[]; ageFails?: boolean; log?: string[] } = {}): SpawnFn {
  const entries = JSON.stringify((options.tarEntries ?? ["./database.sqlite", "appbluegenji.sql"]).join("\n") + "\n");
  const scripts: Record<string, string> = {
    rclone: `process.stdout.write("ENC:" + process.argv.at(-1) + "\\n")`,
    age: options.ageFails
      ? `process.stdin.resume(); process.stdin.on("end", () => { process.stderr.write("no identity matched /secret/path"); process.exit(1); })`
      : `let d=""; process.stdin.on("data", c => d += c); process.stdin.on("end", () => { if (!d.startsWith("ENC:")) process.exit(1); process.stdout.write("TAR") })`,
    tar: `let d=""; process.stdin.on("data", c => d += c); process.stdin.on("end", () => { if (d !== "TAR") process.exit(2); process.stdout.write(${entries}) })`,
  };
  return (command, args, spawnOptions) => {
    options.log?.push(`${command} ${args.join(" ")}`);
    const lastArg = args.at(-1) ?? "";
    return spawn(process.execPath, ["-e", scripts[command], "--", lastArg], spawnOptions);
  };
}

const config = (overrides: Partial<BackupCheckConfig> = {}): BackupCheckConfig => ({
  sources: { localDir: null, remote: "store:BlueGenji/backups", identity: "/k/id.key" },
  uploadsRemote: "store-crypt:uploads",
  recipientsFile: "/k/recipients.txt",
  ...overrides,
});

/** Exécuteur simulé : réponses par commande, appels relevés. */
function fakeRun(answers: Record<string, string | Error>, calls: string[][] = []): CommandRunner {
  return async (command, args) => {
    calls.push([command, ...args]);
    const key = `${command} ${args[0]}`;
    const answer = answers[key];
    if (answer instanceof Error) {
      throw answer;
    }
    return answer ?? "";
  };
}

const archiveListing = "bluegenji-2026-09-28.tar.age\nbluegenji-2026-09-21.tar.age\n";

test("runPipeline relie les processus par leurs tubes et rend la sortie du dernier", async () => {
  const out = await runPipeline(
    [
      { command: "rclone", args: ["cat", "store:x/a.tar.age"] },
      { command: "age", args: ["--decrypt"] },
      { command: "tar", args: ["-t", "-f", "-"] },
    ],
    fakeSpawn(),
  );
  assert.deepEqual(parseTarListing(out), ["database.sqlite", "appbluegenji.sql"]);
});

test("runPipeline échoue sur un code de sortie non nul sans recopier la sortie d'erreur dans le message", async () => {
  await assert.rejects(
    runPipeline(
      [
        { command: "rclone", args: ["cat", "x"] },
        { command: "age", args: ["--decrypt"] },
        { command: "tar", args: ["-t"] },
      ],
      fakeSpawn({ ageFails: true }),
    ),
    (error: Error & { diagnostics?: string }) => {
      assert.match(error.message, /étape age/);
      assert.doesNotMatch(error.message, /secret/);
      assert.match(error.diagnostics ?? "", /secret/);
      return true;
    },
  );
});

test("runPipeline échoue quand un binaire manque", async () => {
  const missing: SpawnFn = (_command, args, options) => spawn("binaire-inexistant-bluegenji", args, options);
  await assert.rejects(runPipeline([{ command: "age", args: [] }], missing), /étape age/);
});

test("runPipeline arrête le tube au-delà du délai", async () => {
  const slow: SpawnFn = (_command, _args, options) => spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], options);
  await assert.rejects(runPipeline([{ command: "age", args: [] }], slow, 200), /délai dépassé/);
});

test("checkLatestArchive déchiffre la plus récente archive distante en flux", async () => {
  const log: string[] = [];
  const result = await checkLatestArchive(config(), {
    run: fakeRun({ "rclone lsf": archiveListing }),
    spawnFn: fakeSpawn({ log }),
  });
  assert.equal(result.ok, true);
  assert.match(result.detail, /bluegenji-2026-09-28\.tar\.age/);
  // rclone cat → age → tar -t : rien n'est téléchargé ni extrait sur disque.
  assert.deepEqual(log, [
    "rclone cat store:BlueGenji/backups/bluegenji-2026-09-28.tar.age",
    "age --decrypt -i /k/id.key",
    "tar -t -f -",
  ]);
  assert.ok(!log.some((line) => /copyto|-x/.test(line)));
});

test("checkLatestArchive lit une archive locale sans passer par rclone", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bg-check-"));
  try {
    fs.writeFileSync(path.join(dir, "bluegenji-2026-09-28.tar.age"), "");
    const log: string[] = [];
    const scripts: SpawnFn = (command, args, options) => {
      log.push(`${command} ${args.join(" ")}`);
      const body = command === "age" ? `process.stdout.write("TAR")` : `process.stdin.resume(); process.stdin.on("end", () => process.stdout.write("database.sqlite\\nappbluegenji.sql\\n"))`;
      return spawn(process.execPath, ["-e", body], options);
    };
    const result = await checkLatestArchive(config({ sources: { localDir: dir, remote: null, identity: "/k/id.key" } }), { spawnFn: scripts });
    assert.equal(result.ok, true);
    assert.equal(log[0], `age --decrypt -i /k/id.key ${path.join(dir, "bluegenji-2026-09-28.tar.age")}`);
    assert.equal(log.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("checkLatestArchive signale une archive incomplète", async () => {
  const result = await checkLatestArchive(config(), {
    run: fakeRun({ "rclone lsf": archiveListing }),
    spawnFn: fakeSpawn({ tarEntries: ["database.sqlite"] }),
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /manque appbluegenji\.sql/);
});

test("checkLatestArchive signale une archive indéchiffrable sans montrer de chemin", async () => {
  const logged: string[] = [];
  const result = await checkLatestArchive(config(), {
    run: fakeRun({ "rclone lsf": archiveListing }),
    spawnFn: fakeSpawn({ ageFails: true }),
    log: (line) => logged.push(line),
  });
  assert.equal(result.ok, false);
  assert.match(result.detail, /ne se déchiffre pas/);
  assert.doesNotMatch(result.detail, /secret|\/k\//);
  assert.match(logged.join("\n"), /secret/);
});

test("checkLatestArchive : stockage injoignable ou vide", async () => {
  const unreachable = await checkLatestArchive(config(), {
    run: fakeRun({ "rclone lsf": new Error("dial tcp backup.example.invalid") }),
    log: () => {},
  });
  assert.equal(unreachable.ok, false);
  assert.doesNotMatch(unreachable.detail, /example/);
  const empty = await checkLatestArchive(config(), { run: fakeRun({ "rclone lsf": "" }) });
  assert.deepEqual([empty.ok, empty.detail], [false, "aucune archive trouvée"]);
});

test("checkUploadsMirror exige un remote crypt qui se liste", async () => {
  const calls: string[][] = [];
  const ok = await checkUploadsMirror(config(), {
    run: fakeRun({ "rclone listremotes": "store:       s3\nstore-crypt: crypt\n", "rclone lsf": "avatars/\n" }, calls),
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(calls[1], ["rclone", "lsf", "store-crypt:uploads", "--max-depth", "1"]);

  const plain = await checkUploadsMirror(config({ uploadsRemote: "store:uploads" }), {
    run: fakeRun({ "rclone listremotes": "store: s3\n" }),
  });
  assert.equal(plain.ok, false);
  assert.match(plain.detail, /pas chiffré/);

  const unknown = await checkUploadsMirror(config(), { run: fakeRun({ "rclone listremotes": "store: s3\n" }) });
  assert.match(unknown.detail, /introuvable/);

  const empty = await checkUploadsMirror(config(), {
    run: fakeRun({ "rclone listremotes": "store-crypt: crypt\n", "rclone lsf": "\n" }),
  });
  assert.equal(empty.ok, false);
  assert.match(empty.detail, /mot de passe/);

  const failing = await checkUploadsMirror(config(), {
    run: fakeRun({ "rclone listremotes": "store-crypt: crypt\n", "rclone lsf": new Error("host.example.invalid refused") }),
    log: () => {},
  });
  assert.equal(failing.ok, false);
  assert.doesNotMatch(failing.detail, /example/);

  const missing = await checkUploadsMirror(config({ uploadsRemote: null }));
  assert.equal(missing.ok, false);
});

test("checkRecipientKey compare la clé dérivée au fichier des destinataires", async () => {
  const run = fakeRun({ "age-keygen -y": `${KEY}\n` });
  const match = await checkRecipientKey(config(), { run, readFile: () => `# clé\n${KEY}\n` });
  assert.equal(match.result.ok, true);
  assert.equal(match.publicKey, KEY);

  const other = "age1zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz";
  const mismatch = await checkRecipientKey(config(), { run, readFile: () => `${other}\n` });
  assert.equal(mismatch.result.ok, false);
  assert.match(mismatch.result.detail, /🚨.*PAS/);
  assert.equal(mismatch.publicKey, KEY);

  const absent = await checkRecipientKey(config(), { run, readFile: () => null });
  assert.equal(absent.result.ok, false);

  const unreadable = await checkRecipientKey(config(), {
    run: fakeRun({ "age-keygen -y": new Error("open /k/id.key: permission denied") }),
    readFile: () => KEY,
    log: () => {},
  });
  assert.equal(unreadable.publicKey, null);
  assert.doesNotMatch(unreadable.result.detail, /\/k\//);
});

test("parseRecipients et parseEnvFile ignorent commentaires et lignes vides", () => {
  assert.deepEqual(parseRecipients(`# commentaire\n\n${KEY}\r\nAGE-SECRET-KEY-1XYZ\n`), [KEY]);
  assert.deepEqual(
    parseEnvFile(`# c\nUPLOADS_RCLONE_REMOTE=store-crypt\nexport UPLOADS_REMOTE_DIR="up loads"\nX='y' \nZ=1 # note\n`),
    { UPLOADS_RCLONE_REMOTE: "store-crypt", UPLOADS_REMOTE_DIR: "up loads", X: "y", Z: "1" },
  );
});

test("backupCheckConfigFromEnv prend l'environnement du bot, puis le fichier du script", () => {
  const scriptEnv = "UPLOADS_RCLONE_REMOTE=store-crypt\nUPLOADS_REMOTE_DIR=images\nAGE_RECIPIENTS_FILE=/etc/bg/recipients.txt\n";
  const fromScript = backupCheckConfigFromEnv({ BACKUP_RCLONE_REMOTE: "store:b" }, () => scriptEnv);
  assert.equal(fromScript.uploadsRemote, "store-crypt:images");
  assert.equal(fromScript.recipientsFile, path.resolve("/etc/bg/recipients.txt"));

  const fromEnv = backupCheckConfigFromEnv(
    { BACKUP_UPLOADS_REMOTE: "x-crypt:u", BACKUP_RECIPIENTS_FILE: "/r.txt" },
    () => scriptEnv,
  );
  assert.equal(fromEnv.uploadsRemote, "x-crypt:u");
  assert.equal(fromEnv.recipientsFile, path.resolve("/r.txt"));

  const nothing = backupCheckConfigFromEnv({}, () => null);
  assert.equal(nothing.uploadsRemote, null);
  assert.equal(nothing.recipientsFile, path.resolve("scripts/backup-recipients.txt"));
});

test("formatBackupChecks met les échecs en rouge et montre la clé publique", () => {
  const report = {
    checks: [
      { label: "Archive la plus récente", ok: true, detail: "ok" },
      { label: "Miroir des images", ok: false, detail: "remote chiffré illisible" },
    ],
    publicKey: KEY,
  };
  const text = formatBackupChecks(report);
  assert.equal(backupChecksPassed(report), false);
  assert.match(text, /✅ Archive/);
  assert.match(text, /❌ Miroir des images : remote chiffré illisible/);
  assert.match(text, /```diff\n- ÉCHEC MIROIR DES IMAGES\n```/);
  assert.match(text, new RegExp(`\`${KEY}\``));
  assert.match(text, /age-keygen -y <copie>/);

  const allGood = formatBackupChecks({ checks: [report.checks[0]], publicKey: null });
  assert.doesNotMatch(allGood, /```diff/);
  assert.match(allGood, /indisponible/);
});

/** Interaction minimale : relève ce qui est répondu. */
function fakeInteraction(userId: string) {
  const replies: { content: string; deferred: boolean }[] = [];
  let deferred = false;
  const interaction = {
    user: { id: userId },
    client: {},
    deferReply: async () => {
      deferred = true;
    },
    reply: async ({ content }: { content: string }) => {
      replies.push({ content, deferred });
    },
    editReply: async ({ content }: { content: string }) => {
      replies.push({ content, deferred });
    },
  };
  return { interaction: interaction as never, replies, isDeferred: () => deferred };
}

test("/backup-check est réservé à OWNER_ID et ne joue rien pour un autre compte", async () => {
  const previous = process.env.OWNER_ID;
  process.env.OWNER_ID = "1";
  try {
    let ran = false;
    const { interaction, replies, isDeferred } = fakeInteraction("2");
    await answerBackupCheck(interaction, async () => {
      ran = true;
      return { checks: [], publicKey: null };
    });
    assert.equal(ran, false);
    assert.equal(isDeferred(), false);
    assert.match(replies[0].content, /réservée au propriétaire/);

    delete process.env.OWNER_ID;
    const unset = fakeInteraction("2");
    await answerBackupCheck(unset.interaction, async () => ({ checks: [], publicKey: null }));
    assert.match(unset.replies[0].content, /réservée/);
  } finally {
    if (previous === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = previous;
  }
});

test("/backup-check diffère sa réponse puis rend le rapport, et tait une erreur imprévue", async () => {
  const previous = process.env.OWNER_ID;
  process.env.OWNER_ID = "1";
  try {
    const ok = fakeInteraction("1");
    await answerBackupCheck(ok.interaction, async () => ({
      checks: [{ label: "Clé de déchiffrement", ok: true, detail: "correspond" }],
      publicKey: KEY,
    }));
    assert.equal(ok.replies.length, 1);
    assert.equal(ok.replies[0].deferred, true);
    assert.match(ok.replies[0].content, new RegExp(KEY));

    const boom = fakeInteraction("1");
    await answerBackupCheck(boom.interaction, async () => {
      throw new Error("/home/x/secret");
    });
    assert.match(boom.replies[0].content, /Vérification impossible/);
    assert.doesNotMatch(boom.replies[0].content, /secret/);
  } finally {
    if (previous === undefined) delete process.env.OWNER_ID;
    else process.env.OWNER_ID = previous;
  }
});
