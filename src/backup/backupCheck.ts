/**
 * Vérification que les sauvegardes **se relisent**, jouée dans le rapport
 * hebdomadaire et par `/backup-check`.
 *
 * Le statut laissé par `scripts/backup-onedrive.sh` dit qu'une archive est
 * partie ; il ne dit pas qu'on saura l'ouvrir le jour où il le faudra. Trois
 * contrôles, aucun n'écrivant de donnée déchiffrée sur disque :
 *
 * 1. **Archive** — la plus récente (`archiveSource.ts`) est déchiffrée **en
 *    flux** (`rclone cat` | `age --decrypt` | `tar -t`) : seule la liste des
 *    fichiers qu'elle contient sort du tube, et l'on y attend
 *    `database.sqlite` et `appbluegenji.sql`.
 * 2. **Miroir des images** — le remote `crypt` des images se liste
 *    (`rclone lsf`, un niveau) : des noms déchiffrables prouvent que le mot de
 *    passe du remote est le bon. Rien n'est téléchargé, aucun nom n'est
 *    montré.
 * 3. **Clé** — la clé publique tirée de la clé privée (`age-keygen -y`) doit
 *    figurer dans `backup-recipients.txt`, sans quoi les sauvegardes sont
 *    chiffrées pour une clé que le bot ne détient pas. Elle est **montrée**
 *    (une clé publique n'est pas un secret) pour que le propriétaire la
 *    compare à sa copie hors ligne.
 *
 * Ce qui part sur Discord ne contient ni chemin, ni nom d'hôte, ni nom de
 * remote, ni sortie d'erreur d'une commande (qui en porterait) : seulement un
 * libellé et un verdict. Le détail va au journal du processus (pm2).
 *
 * Configuration (`.env` du bot), toutes facultatives :
 * - archives : `BACKUP_ARCHIVE_DIR` / `BACKUP_RCLONE_REMOTE` (ceux de
 *   `/restore-backup`) ; sans distant réglé, `RCLONE_REMOTE:REMOTE_DIR` du
 *   fichier du script de sauvegarde s'y ajoute ;
 * - `BACKUP_UPLOADS_REMOTE` : remote `crypt` et dossier des images
 *   (`nom-crypt:uploads`) ; à défaut, `UPLOADS_RCLONE_REMOTE` et
 *   `UPLOADS_REMOTE_DIR` du même fichier ;
 * - `BACKUP_RECIPIENTS_FILE` : fichier des clés publiques ; à défaut,
 *   `AGE_RECIPIENTS_FILE` du même fichier (chemin relatif non deviné), puis
 *   `scripts/backup-recipients.txt` ;
 * - `BACKUP_ONEDRIVE_ENV` (ou `BACKUP_CONFIG`, celle du script) : chemin de ce
 *   fichier (défaut `scripts/backup-onedrive.env`, relatif au dossier du bot).
 *
 * `appbluegenji.sql` n'est attendu que si le script a MySQL à sauvegarder
 * (`MYSQL_DEFAULTS_FILE` et `DB_DATABASE`), comme le script lui-même.
 */

import { execFile, spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  archiveSourcesFromEnv,
  listArchives,
  type ArchiveSources,
  type CommandRunner,
} from "@/backup/archiveSource.js";

const execFileAsync = promisify(execFile);

/** Fichiers qu'une archive complète doit contenir. */
export const EXPECTED_ARCHIVE_ENTRIES = ["database.sqlite", "appbluegenji.sql"] as const;
/**
 * Délai maximal d'une commande. Listage puis déchiffrement se suivent : deux
 * délais doivent tenir sous les 15 min d'une réponse différée de Discord.
 */
const CHECK_TIMEOUT_MS = 6 * 60 * 1000;
/** Plafond de la sortie lue au bout du tube : une liste de fichiers, rien de plus. */
const MAX_LISTING_BYTES = 64 * 1024;

/** Lance un processus ; injectable pour les tests. */
export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

/** Échec d'un tube : l'étape fautive, et ses sorties d'erreur (journal seulement). */
export type PipelineError = Error & { stage?: string; diagnostics?: string };

/** Une étape d'un tube. */
export interface PipelineStage {
  command: string;
  args: string[];
}

/** Verdict d'un contrôle, sans rien qui doive rester sur la machine. */
export interface CheckResult {
  /** Libellé générique (« Archive », « Miroir des images », « Clé »). */
  label: string;
  ok: boolean;
  /** Détail montrable : date d'archive, fichiers manquants, verdict lisible. */
  detail: string;
}

/** Résultat complet, et la clé publique à comparer à la copie hors ligne. */
export interface BackupCheckReport {
  checks: CheckResult[];
  /** Clé publique tirée de la clé privée, ou `null` si elle n'a pu l'être. */
  publicKey: string | null;
}

/** Où lire ce que les contrôles 2 et 3 attendent. */
export interface BackupCheckConfig {
  sources: ArchiveSources;
  /** Remote `crypt` et dossier des images, ou `null` s'il n'est pas configuré. */
  uploadsRemote: string | null;
  /**
   * `false` quand le script ne sauvegarde aucune image (`UPLOADS_DIR` vide) :
   * le contrôle du miroir est alors sans objet, et non en échec.
   */
  uploadsExpected: boolean;
  /** Fichier des clés publiques autorisées, `null` s'il n'a pas pu être résolu. */
  recipientsFile: string | null;
  /** Fichiers que la dernière archive doit contenir. */
  expectedEntries: string[];
}

/** Exécuteur par défaut : `execFile`, sans shell. */
const defaultRunner: CommandRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, { timeout: CHECK_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
  return stdout;
};

/**
 * Lit un fichier `KEY=VALUE` (celui de `scripts/backup-onedrive.sh`), sans
 * l'exécuter : ni substitution, ni commande. Guillemets simples ou doubles
 * retirés, commentaires et lignes vides ignorés.
 * @param content Contenu du fichier.
 * @returns Les couples lus.
 */
export function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    const quote = value[0];
    const closing = quote === '"' || quote === "'" ? value.indexOf(quote, 1) : -1;
    if (closing > 0) {
      // Valeur entre guillemets, éventuellement suivie d'un commentaire.
      value = value.slice(1, closing);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    values[match[1]] = value;
  }
  return values;
}

/**
 * Compose la configuration des contrôles depuis l'environnement du bot et,
 * à défaut, depuis le fichier de configuration du script de sauvegarde.
 * @param env Environnement (par défaut `process.env`).
 * @param readFile Lecture d'un fichier ; `null` s'il est absent.
 * @returns La configuration.
 */
export function backupCheckConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  readFile: (file: string) => string | null = readOptionalFile,
): BackupCheckConfig {
  const scriptEnvPath = path.resolve(
    env.BACKUP_ONEDRIVE_ENV?.trim() || env.BACKUP_CONFIG?.trim() || "scripts/backup-onedrive.env",
  );
  // `$SCRIPT_DIR` est le dossier du script (`scripts/` du bot), pas celui de
  // sa configuration : `BACKUP_CONFIG` peut la placer ailleurs.
  const scriptDir = path.resolve("scripts");
  const content = readFile(scriptEnvPath);
  const scriptEnv = parseEnvFile(content ?? "");
  const scriptPath = (key: string): string | null => resolveScriptPath(scriptEnv[key], scriptDir);

  // Défauts du script lui-même (`backup-onedrive.sh`,
  // `sync-uploads-onedrive.sh`), seulement quand son fichier a pu être lu.
  const scriptRemote = content === null ? null : (scriptEnv.RCLONE_REMOTE || "onedrive").replace(/:$/, "");

  let uploadsRemote = env.BACKUP_UPLOADS_REMOTE?.trim() || null;
  // Le miroir des images n'existe que si le script a un dossier à copier.
  const uploadsExpected = Boolean(uploadsRemote) || content === null || Boolean(scriptEnv.UPLOADS_DIR);
  if (!uploadsRemote && content !== null && scriptEnv.UPLOADS_DIR) {
    const name = (scriptEnv.UPLOADS_RCLONE_REMOTE || scriptRemote || "").replace(/:$/, "");
    uploadsRemote = name ? `${name}:${scriptEnv.UPLOADS_REMOTE_DIR || "uploads"}` : null;
  }
  // Un `AGE_RECIPIENTS_FILE` que l'on ne sait pas résoudre comme bash (chemin
  // relatif au répertoire de cron, autre variable) n'est pas remplacé par le
  // défaut : on vérifierait un autre fichier que celui qui chiffre.
  const recipientsFile = env.BACKUP_RECIPIENTS_FILE?.trim()
    ? path.resolve(env.BACKUP_RECIPIENTS_FILE.trim())
    : scriptEnv.AGE_RECIPIENTS_FILE
      ? scriptPath("AGE_RECIPIENTS_FILE")
      : path.join(scriptDir, "backup-recipients.txt");

  // Les archives : celles de `/restore-backup`, plus le stockage où écrit le
  // script quand aucun distant n'est réglé — le script ne garde aucune archive
  // en local, un vieux dossier de restauration masquerait sinon les nouvelles.
  const sources = archiveSourcesFromEnv(env);
  if (!sources.remote && scriptRemote) {
    sources.remote = `${scriptRemote}:${scriptEnv.REMOTE_DIR || "BlueGenji/backups"}`;
  }
  // Le script n'ajoute le dump du site que si MySQL est configuré : sans lui,
  // l'exiger ferait du rapport une fausse alerte permanente. Fichier du script
  // illisible : on attend l'archive complète, celle de la production.
  const siteDumpConfigured = content === null || Boolean(scriptEnv.MYSQL_DEFAULTS_FILE && scriptEnv.DB_DATABASE);
  const expectedEntries = siteDumpConfigured ? [...EXPECTED_ARCHIVE_ENTRIES] : ["database.sqlite"];
  return { sources, uploadsRemote, uploadsExpected, recipientsFile, expectedEntries };
}

/**
 * Résout un chemin lu dans le fichier du script, comme bash l'aurait fait pour
 * les seules formes que ce fichier emploie : `$SCRIPT_DIR` / `${SCRIPT_DIR}`,
 * `~` et `$HOME` en tête, chemin absolu. Ni une autre substitution ni un
 * chemin relatif (bash le lirait depuis le répertoire de cron, que le bot ne
 * connaît pas) ne sont devinés : la valeur est écartée.
 * @param value Valeur brute, ou `undefined`.
 * @param scriptDir Dossier du script de sauvegarde.
 * @returns Le chemin absolu, ou `null`.
 */
export function resolveScriptPath(value: string | undefined, scriptDir: string): string | null {
  if (!value) {
    return null;
  }
  const expanded = value
    .replace(/^(\$\{SCRIPT_DIR\}|\$SCRIPT_DIR)(?=\/|$)/, scriptDir)
    .replace(/^(~|\$\{HOME\}|\$HOME)(?=\/|$)/, os.homedir());
  if (expanded.includes("$") || !path.isAbsolute(expanded)) {
    return null;
  }
  return path.resolve(expanded);
}

/**
 * Lit un fichier qui peut ne pas exister.
 * @param file Chemin.
 * @returns Son contenu, ou `null`.
 */
function readOptionalFile(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/**
 * Enchaîne des processus par leurs tubes et rend la sortie du dernier.
 *
 * Rien ne touche le disque : chaque étape lit la sortie de la précédente. Un
 * code de sortie non nul, un binaire absent ou le délai dépassé font échouer
 * l'ensemble, et tous les processus sont arrêtés. Le message d'échec ne nomme
 * que l'étape (`age`, `tar`…), jamais sa sortie d'erreur, qui peut porter un
 * chemin ou un hôte : celle-ci est rendue à part, pour le journal.
 * @param stages Étapes, dans l'ordre du tube.
 * @param spawnFn Lanceur de processus.
 * @param timeoutMs Délai maximal.
 * @returns La sortie du dernier processus.
 */
export function runPipeline(
  stages: PipelineStage[],
  spawnFn: SpawnFn = spawn as SpawnFn,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const children: ChildProcess[] = [];
    const diagnostics: string[] = [];
    // Étapes en échec **par elles-mêmes** (code de sortie, binaire absent) ;
    // celles que l'on arrête ensuite ne comptent pas, quel que soit leur code
    // (`rclone` intercepte SIGTERM et sort en 143). L'étape nommée est la **première** du tube : quand
    // `rclone` échoue, `age` échoue aussi faute d'entrée, et c'est le stockage
    // qu'il faut mettre en cause, pas la clé.
    const failed = new Set<number>();
    // Binaire introuvable : le défaut est certain, il l'emporte sur tout code
    // de sortie (les autres étapes, arrêtées aussitôt, ne disent rien).
    const missing = new Set<number>();
    let timedOut = false;
    let interrupted = false;
    let pending = stages.length;
    let output = "";
    let truncated = false;
    const settled = new Set<number>();
    const killed = new Set<number>();
    const killAll = (): void => {
      children.forEach((child, index) => {
        if (!settled.has(index)) {
          killed.add(index);
        }
        child.kill();
      });
    };
    const timer = setTimeout(() => {
      timedOut = true;
      killAll();
    }, timeoutMs);

    const done = (index: number, code: number | null): void => {
      if (settled.has(index)) {
        return;
      }
      settled.add(index);
      if (code !== 0) {
        interrupted = true;
        if (code !== null && !killed.has(index)) {
          failed.add(index);
        }
        killAll();
      }
      pending--;
      if (pending > 0) {
        return;
      }
      clearTimeout(timer);
      let failedStage: string | null = null;
      if (timedOut) {
        failedStage = "délai dépassé";
      } else if (missing.size > 0) {
        failedStage = `${stages[Math.min(...missing)].command} absent`;
      } else if (failed.size > 0) {
        failedStage = stages[Math.min(...failed)].command;
      } else if (interrupted) {
        failedStage = "interrompue";
      }
      if (failedStage) {
        const error = new Error(`échec de l'étape ${failedStage}`) as PipelineError;
        error.stage = failedStage;
        error.diagnostics = diagnostics.join(" ; ");
        reject(error);
      } else {
        resolve(output);
      }
    };

    stages.forEach((stage, index) => {
      const first = index === 0;
      const child = spawnFn(stage.command, stage.args, { stdio: [first ? "ignore" : "pipe", "pipe", "pipe"] });
      children.push(child);
      child.stderr?.on("data", (chunk: Buffer) => diagnostics.push(`${stage.command}: ${chunk.toString().trim()}`));
      // Un tube rompu (l'étape suivante a échoué) ne doit pas faire lever le bot.
      child.stdin?.on("error", () => {});
      child.on("error", (error) => {
        diagnostics.push(`${stage.command}: ${error.message}`);
        missing.add(index);
        done(index, 1);
      });
      child.on("close", (code) => done(index, code));
      if (!first) {
        children[index - 1].stdout?.pipe(child.stdin!);
      }
    });

    const last = children[children.length - 1];
    last.stdout?.on("data", (chunk: Buffer) => {
      if (output.length + chunk.length > MAX_LISTING_BYTES) {
        truncated = true;
        return;
      }
      output += chunk.toString();
    });
    last.stdout?.on("end", () => {
      if (truncated) {
        diagnostics.push("sortie tronquée");
      }
    });
  });
}

/**
 * Noms de fichiers d'une sortie `tar -t`, `./` de tête retiré.
 * @param listing Sortie brute.
 * @returns Les noms.
 */
export function parseTarListing(listing: string): string[] {
  return listing
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^\.\//, ""))
    .filter((line) => line.length > 0);
}

/**
 * Désigne un fichier d'un remote rclone (`nom:dossier` + nom).
 * @param remote Remote et dossier.
 * @param name Nom du fichier.
 * @returns Le chemin rclone.
 */
function remotePath(remote: string, name: string): string {
  return remote.endsWith("/") || remote.endsWith(":") ? `${remote}${name}` : `${remote}/${name}`;
}

/** Dépendances des contrôles, toutes remplaçables en test. */
export interface BackupCheckDeps {
  run?: CommandRunner;
  spawnFn?: SpawnFn;
  readFile?: (file: string) => string | null;
  /** Journal des détails techniques (pm2), jamais envoyé sur Discord. */
  log?: (message: string) => void;
}

/**
 * Journalise un échec sans le montrer : le message d'une commande peut nommer
 * un chemin, un remote ou un hôte.
 * @param log Journal.
 * @param label Contrôle concerné.
 * @param error Erreur levée.
 */
function logFailure(log: (message: string) => void, label: string, error: unknown): void {
  const err = error as Error & { diagnostics?: string };
  log(`[backup-check] ${label} : ${err.message}${err.diagnostics ? ` — ${err.diagnostics}` : ""}`);
}

/**
 * Contrôle 1 : la plus récente archive se déchiffre et contient les deux bases.
 * @param config Configuration.
 * @param deps Dépendances.
 * @returns Le verdict.
 */
export async function checkLatestArchive(config: BackupCheckConfig, deps: BackupCheckDeps = {}): Promise<CheckResult> {
  const label = "Archive la plus récente";
  const log = deps.log ?? console.error;
  let archives;
  let failures: string[];
  try {
    ({ archives, failures } = await listArchives(config.sources, deps.run ?? defaultRunner));
  } catch (error) {
    logFailure(log, label, error);
    return { label, ok: false, detail: "stockage des archives illisible" };
  }
  const latest = archives[0];
  if (!latest) {
    return { label, ok: false, detail: "aucune archive trouvée" };
  }
  const decrypt: PipelineStage = { command: "age", args: ["--decrypt", "-i", config.sources.identity] };
  const stages: PipelineStage[] =
    latest.location === "local" && config.sources.localDir
      ? [{ command: "age", args: [...decrypt.args, path.join(config.sources.localDir, latest.name)] }]
      : [{ command: "rclone", args: ["cat", remotePath(config.sources.remote ?? "", latest.name)] }, decrypt];
  stages.push({ command: "tar", args: ["-t", "-f", "-"] });

  let entries: string[];
  try {
    entries = parseTarListing(await runPipeline(stages, deps.spawnFn));
  } catch (error) {
    logFailure(log, label, error);
    return { label, ok: false, detail: `\`${latest.name}\` : ${pipelineFailureText((error as PipelineError).stage)}` };
  }
  const missing = config.expectedEntries.filter((name) => !entries.includes(name));
  if (missing.length > 0) {
    return { label, ok: false, detail: `\`${latest.name}\` déchiffrée mais incomplète — manque ${missing.join(", ")}` };
  }
  const site = config.expectedEntries.includes("appbluegenji.sql") ? "" : " (dump du site non configuré)";
  const verified = `\`${latest.name}\` déchiffrée, ${config.expectedEntries.join(" et ")} présents${site}`;
  // Une source muette (stockage distant injoignable, dossier local illisible) :
  // l'archive lue n'est peut-être pas la plus récente — le contrôle ne peut
  // pas s'annoncer réussi sur ce qu'il n'a pas vu.
  if (failures.length > 0) {
    for (const failure of failures) {
      log(`[backup-check] ${label} : ${failure}`);
    }
    return { label, ok: false, detail: `une source d'archives n'a pas répondu — seule ${verified}, peut-être pas la plus récente` };
  }
  return { label, ok: true, detail: verified };
}

/**
 * Phrase d'un échec du tube de déchiffrement, d'après l'étape qui a cédé :
 * une panne du stockage ne doit pas se lire comme une clé perdue.
 * @param stage Étape fautive (`rclone`, `age`, `tar`, `délai dépassé`…).
 * @returns La phrase montrable.
 */
export function pipelineFailureText(stage: string | undefined): string {
  switch (stage) {
    case "rclone":
      return "lecture sur le stockage distant impossible (stockage injoignable ?)";
    case "age":
      return "ne se déchiffre pas avec la clé du bot";
    case "tar":
      return "déchiffrée, mais illisible comme archive tar";
    case "délai dépassé":
      return "délai dépassé pendant la lecture";
    case "rclone absent":
    case "age absent":
    case "tar absent":
      return `\`${stage.replace(/ absent$/, "")}\` introuvable sur le serveur`;
    default:
      return "lecture interrompue";
  }
}

/**
 * Contrôle 2 : le miroir chiffré des images se lit.
 * @param config Configuration.
 * @param deps Dépendances.
 * @returns Le verdict.
 */
export async function checkUploadsMirror(config: BackupCheckConfig, deps: BackupCheckDeps = {}): Promise<CheckResult> {
  const label = "Miroir des images";
  const log = deps.log ?? console.error;
  const run = deps.run ?? defaultRunner;
  if (!config.uploadsExpected) {
    // Le script ne copie aucune image (`UPLOADS_DIR` vide) : rien à vérifier.
    return { label, ok: true, detail: "sans objet — aucune image sauvegardée (UPLOADS_DIR vide)" };
  }
  if (!config.uploadsRemote) {
    return { label, ok: false, detail: "non configuré (BACKUP_UPLOADS_REMOTE)" };
  }
  const name = config.uploadsRemote.split(":")[0];
  try {
    const remotes = await run("rclone", ["listremotes", "--long"]);
    const type = remotes
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .find(([remote]) => remote === `${name}:`)?.[1];
    if (!type) {
      return { label, ok: false, detail: "remote introuvable dans la configuration rclone" };
    }
    if (type !== "crypt") {
      return { label, ok: false, detail: "le remote des images n'est pas chiffré (type autre que crypt)" };
    }
    const listing = await run("rclone", ["lsf", config.uploadsRemote, "--max-depth", "1"]);
    if (listing.split(/\r?\n/).every((line) => line.trim().length === 0)) {
      return { label, ok: false, detail: "aucune entrée lisible (miroir vide ou mot de passe du remote faux)" };
    }
  } catch (error) {
    logFailure(log, label, error);
    return { label, ok: false, detail: "remote chiffré illisible" };
  }
  return { label, ok: true, detail: "remote chiffré lisible" };
}

/**
 * Clés publiques d'un fichier de destinataires age.
 * @param content Contenu du fichier.
 * @returns Les clés `age1…`.
 */
export function parseRecipients(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^age1[0-9a-z]+$/.test(line));
}

/**
 * Contrôle 3 : la clé privée du bot correspond à une clé de chiffrement.
 * @param config Configuration.
 * @param deps Dépendances.
 * @returns Le verdict et la clé publique dérivée.
 */
export async function checkRecipientKey(
  config: BackupCheckConfig,
  deps: BackupCheckDeps = {},
): Promise<{ result: CheckResult; publicKey: string | null }> {
  const label = "Clé de déchiffrement";
  const log = deps.log ?? console.error;
  let publicKey: string | null;
  try {
    publicKey = parseRecipients(await (deps.run ?? defaultRunner)("age-keygen", ["-y", config.sources.identity]))[0] ?? null;
  } catch (error) {
    logFailure(log, label, error);
    publicKey = null;
  }
  if (!publicKey) {
    return { result: { label, ok: false, detail: "clé privée du bot illisible" }, publicKey: null };
  }
  if (!config.recipientsFile) {
    return {
      result: { label, ok: false, detail: "fichier des clés publiques non résolu (AGE_RECIPIENTS_FILE) — régler BACKUP_RECIPIENTS_FILE" },
      publicKey,
    };
  }
  const content = (deps.readFile ?? readOptionalFile)(config.recipientsFile);
  if (content === null) {
    return { result: { label, ok: false, detail: "fichier des clés publiques (backup-recipients.txt) introuvable" }, publicKey };
  }
  if (!parseRecipients(content).includes(publicKey)) {
    return {
      result: {
        label,
        ok: false,
        detail: "🚨 la clé du bot n'est PAS dans backup-recipients.txt : les sauvegardes sont chiffrées pour une autre clé",
      },
      publicKey,
    };
  }
  return { result: { label, ok: true, detail: "correspond à backup-recipients.txt" }, publicKey };
}

/**
 * Joue les trois contrôles.
 * @param config Configuration (par défaut, lue dans l'environnement).
 * @param deps Dépendances.
 * @returns Les verdicts et la clé publique.
 */
export async function runBackupChecks(
  config: BackupCheckConfig = backupCheckConfigFromEnv(),
  deps: BackupCheckDeps = {},
): Promise<BackupCheckReport> {
  // En parallèle : la durée totale est celle du plus long (listage puis
  // déchiffrement de l'archive), qui tient sous les 15 min d'une réponse
  // différée de Discord.
  const [key, archive, mirror] = await Promise.all([
    checkRecipientKey(config, deps),
    checkLatestArchive(config, deps),
    checkUploadsMirror(config, deps),
  ]);
  return { checks: [archive, mirror, key.result], publicKey: key.publicKey };
}

/**
 * `true` si tous les contrôles ont réussi.
 * @param report Rapport.
 * @returns Le verdict global.
 */
export function backupChecksPassed(report: BackupCheckReport): boolean {
  return report.checks.every((check) => check.ok);
}

/**
 * Met le rapport en forme pour Discord. Les échecs sont dans un bloc `diff`,
 * où Discord rend en **rouge** les lignes qui commencent par `-` : un échec
 * doit se voir sans lire.
 * @param report Rapport.
 * @returns Le texte du message.
 */
export function formatBackupChecks(report: BackupCheckReport): string {
  const lines = report.checks.map((check) => `${check.ok ? "✅" : "❌"} ${check.label} : ${check.detail}`);
  const failures = report.checks.filter((check) => !check.ok);
  const keyLine = report.publicKey
    ? `🔑 Clé publique des sauvegardes : \`${report.publicKey}\`\n` +
      "Compare-la à ta copie hors ligne : `age-keygen -y <copie>` doit afficher exactement cette clé."
    : "🔑 Clé publique des sauvegardes : indisponible.";
  const block =
    failures.length > 0
      ? `\n\`\`\`diff\n${failures.map((check) => `- ÉCHEC ${check.label.toUpperCase()}`).join("\n")}\n\`\`\``
      : "";
  return `Vérification de restauration :\n${lines.join("\n")}${block}\n${keyLine}`;
}
