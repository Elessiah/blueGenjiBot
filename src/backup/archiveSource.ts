/**
 * Archives chiffrées que `/restore-backup` sait restaurer, lues **sur la
 * machine du bot** — jamais via Discord.
 *
 * La commande prenait la base **déchiffrée** en pièce jointe : toute la base
 * partait en clair sur le CDN de Discord, sans durée connue, alors que les
 * textes annoncent des sauvegardes « chiffrées, 30 jours au plus ». Elle lit
 * désormais une archive `bluegenji-AAAA-MM-JJ.tar.age` (celles de
 * `scripts/backup-onedrive.sh`) dans un dossier local, ou à défaut sur le
 * stockage distant (remote rclone), la déchiffre sur place avec la clé age
 * de l'exploitant, et n'en extrait que `database.sqlite`.
 *
 * Configuration (`.env` du bot) :
 * - `BACKUP_ARCHIVE_DIR` : dossier local d'archives (facultatif) ;
 * - `BACKUP_RCLONE_REMOTE` : remote et dossier distants, par exemple
 *   `onedrive:BlueGenji/backups` (facultatif) ;
 * - `BACKUP_AGE_IDENTITY` : clé privée age (défaut `~/.bluegenji-backup.key`).
 */

import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Nom d'une archive écrite par `scripts/backup-onedrive.sh`. */
export const ARCHIVE_NAME = /^bluegenji-(\d{4}-\d{2}-\d{2})\.tar\.age$/;
/** Délai maximal d'une commande externe (listage, téléchargement, déchiffrement). */
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

/** Où chercher les archives. */
export interface ArchiveSources {
  /** Dossier local, ou `null`. */
  localDir: string | null;
  /** Remote rclone (`nom:dossier`), ou `null`. */
  remote: string | null;
  /** Clé privée age. */
  identity: string;
}

/** Une archive trouvée, et l'endroit où elle l'a été. */
export interface ArchiveRef {
  name: string;
  location: "local" | "remote";
}

/** Exécute une commande externe ; injectable pour les tests. */
export type CommandRunner = (command: string, args: string[]) => Promise<string>;

/** Exécuteur par défaut : `execFile`, sans shell (aucun argument n'est interprété). */
const defaultRunner: CommandRunner = async (command, args) => {
  const { stdout } = await execFileAsync(command, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: 1024 * 1024 });
  return stdout;
};

/**
 * Lit la configuration des sources dans l'environnement.
 * @param env Environnement (par défaut `process.env`).
 * @returns Les sources configurées.
 */
export function archiveSourcesFromEnv(env: NodeJS.ProcessEnv = process.env): ArchiveSources {
  return {
    localDir: env.BACKUP_ARCHIVE_DIR?.trim() || null,
    remote: env.BACKUP_RCLONE_REMOTE?.trim() || null,
    identity: env.BACKUP_AGE_IDENTITY?.trim() || path.join(os.homedir(), ".bluegenji-backup.key"),
  };
}

/**
 * Garde les seuls noms d'archive valides, du plus récent au plus ancien.
 * @param names Noms bruts (listage d'un dossier ou d'un remote).
 * @returns Les noms d'archive, triés par date décroissante, sans doublon.
 */
export function filterArchiveNames(names: string[]): string[] {
  const valid = names.map((name) => name.trim()).filter((name) => ARCHIVE_NAME.test(name));
  return [...new Set(valid)].sort().reverse();
}

/**
 * Désigne l'archive demandée parmi celles qui existent.
 *
 * Seul un nom **déjà listé** peut sortir : la saisie ne compose jamais un
 * chemin, ce qui écarte toute traversée (`../`) et toute option déguisée.
 * @param available Archives disponibles.
 * @param query Date `AAAA-MM-JJ` ou nom exact d'archive.
 * @returns L'archive retenue, ou `null`.
 */
export function pickArchive(available: ArchiveRef[], query: string): ArchiveRef | null {
  const wanted = query.trim();
  const name = /^\d{4}-\d{2}-\d{2}$/.test(wanted) ? `bluegenji-${wanted}.tar.age` : wanted;
  return available.find((archive) => archive.name === name) ?? null;
}

/** Résultat d'un listage : les archives, et les sources qui n'ont pas répondu. */
export interface ArchiveListing {
  /** Archives trouvées, de la plus récente à la plus ancienne. */
  archives: ArchiveRef[];
  /**
   * Échecs des sources qui n'ont pas répondu alors qu'une autre l'a fait :
   * « aucune archive » ne doit pas se lire « aucune sauvegarde » quand le
   * stockage distant est simplement injoignable.
   */
  failures: string[];
}

/**
 * Liste les archives des deux sources. Une archive présente aux deux endroits
 * est lue en local (pas de téléchargement).
 * @param sources Sources configurées.
 * @param run Exécuteur de commandes.
 * @returns Les archives, et les échecs partiels.
 * @throws Si aucune source n'est configurée, ou si toutes ont échoué.
 */
export async function listArchives(sources: ArchiveSources, run: CommandRunner = defaultRunner): Promise<ArchiveListing> {
  if (!sources.localDir && !sources.remote) {
    throw new Error("aucune source d'archives configurée (BACKUP_ARCHIVE_DIR ou BACKUP_RCLONE_REMOTE)");
  }
  const found = new Map<string, ArchiveRef>();
  const failures: string[] = [];

  if (sources.remote) {
    try {
      const out = await run("rclone", ["lsf", sources.remote, "--files-only", "--include", "bluegenji-*.tar.age"]);
      for (const name of filterArchiveNames(out.split("\n"))) {
        found.set(name, { name, location: "remote" });
      }
    } catch (error) {
      failures.push(`stockage distant : ${(error as Error).message}`);
    }
  }
  if (sources.localDir) {
    try {
      for (const name of filterArchiveNames(await fs.promises.readdir(sources.localDir))) {
        found.set(name, { name, location: "local" });
      }
    } catch (error) {
      failures.push(`dossier local : ${(error as Error).message}`);
    }
  }
  const configured = Number(Boolean(sources.localDir)) + Number(Boolean(sources.remote));
  if (failures.length === configured) {
    throw new Error(failures.join(" ; "));
  }
  return {
    archives: [...found.values()].sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0)),
    failures,
  };
}

/**
 * Met l'archive dans `workDir` (copie locale ou téléchargement).
 * @param sources Sources configurées.
 * @param archive Archive retenue par `pickArchive`.
 * @param workDir Dossier de travail privé (créé par `mkdtemp`).
 * @param run Exécuteur de commandes.
 * @returns Le chemin de l'archive chiffrée dans `workDir`.
 */
export async function fetchArchive(
  sources: ArchiveSources,
  archive: ArchiveRef,
  workDir: string,
  run: CommandRunner = defaultRunner,
): Promise<string> {
  const target = path.join(workDir, archive.name);
  if (archive.location === "local" && sources.localDir) {
    await fs.promises.copyFile(path.join(sources.localDir, archive.name), target);
  } else if (sources.remote) {
    const remote = sources.remote.endsWith("/") || sources.remote.endsWith(":") ? sources.remote : `${sources.remote}/`;
    await run("rclone", ["copyto", `${remote}${archive.name}`, target]);
  } else {
    throw new Error("source de l'archive non configurée");
  }
  return target;
}

/**
 * Déchiffre l'archive et n'en extrait que `database.sqlite`.
 *
 * `age` écrit dans un tube que `tar` lit : l'archive en clair — qui porte
 * aussi le dump de la base du site — n'est jamais écrite sur disque.
 * @param archivePath Archive chiffrée.
 * @param identity Clé privée age.
 * @param workDir Dossier de travail privé.
 * @returns Le chemin de la base extraite.
 */
export function decryptDatabase(archivePath: string, identity: string, workDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const age = spawn("age", ["--decrypt", "-i", identity, archivePath], { stdio: ["ignore", "pipe", "pipe"] });
    const tar = spawn("tar", ["-x", "-f", "-", "-C", workDir, "database.sqlite"], { stdio: ["pipe", "ignore", "pipe"] });
    const errors: string[] = [];
    let pending = 2;
    let failed = false;
    const timer = setTimeout(() => {
      age.kill();
      tar.kill();
    }, COMMAND_TIMEOUT_MS);

    age.stdout.pipe(tar.stdin);
    age.stderr.on("data", (chunk: Buffer) => errors.push(`age: ${chunk.toString().trim()}`));
    tar.stderr.on("data", (chunk: Buffer) => errors.push(`tar: ${chunk.toString().trim()}`));
    // Un tube rompu côté tar ne doit pas faire lever le processus du bot.
    tar.stdin.on("error", () => {});

    // Chaque processus se conclut une fois : `error` (binaire absent) peut être
    // suivi ou non de `close` selon la version de Node.
    const settled = new Set<string>();
    const done = (which: string, code: number | null): void => {
      if (settled.has(which)) {
        return;
      }
      settled.add(which);
      if (code !== 0) {
        failed = true;
        // L'autre extrémité du tube n'attendra rien de plus.
        age.kill();
        tar.kill();
      }
      pending--;
      if (pending > 0) {
        return;
      }
      clearTimeout(timer);
      if (failed) {
        reject(new Error(errors.join(" ; ") || "déchiffrement ou extraction impossible"));
      } else {
        resolve(path.join(workDir, "database.sqlite"));
      }
    };
    age.on("error", (error) => {
      errors.push(`age: ${error.message}`);
      done("age", 1);
    });
    tar.on("error", (error) => {
      errors.push(`tar: ${error.message}`);
      done("tar", 1);
    });
    age.on("close", (code) => done("age", code));
    tar.on("close", (code) => done("tar", code));
  });
}
