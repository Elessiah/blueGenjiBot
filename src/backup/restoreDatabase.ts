import fs from "node:fs";
import path from "node:path";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

import { getBddInstance, resetBddInstance, resolveBddPath } from "../bdd/Bdd.js";
import { ROLLBACK_RETENTION_DAYS } from "../privacy/retentionPeriods.js";

/** En-tête que tout fichier SQLite valide porte sur ses seize premiers octets. */
const SQLITE_MAGIC = "SQLite format 3\0";

/** Résultat d'une tentative de restauration. */
export interface RestoreResult {
  /** `true` si la base courante a bien été remplacée. */
  success: boolean;
  /** Message destiné au propriétaire, en français ; en échec, porte l'erreur brute (chemins compris). */
  message: string;
  /**
   * Le même message sans l'erreur brute : ni chemin ni sortie système. Seul
   * texte d'un échec montré sur Discord, le détail allant aux journaux pm2.
   */
  summary: string;
  /** Chemin du filet de sécurité écrit avant l'écrasement, si créé. */
  rollbackPath?: string;
}

/**
 * Vérifie qu'un fichier téléversé est bien une base SQLite exploitable.
 *
 * Le contrôle est double : l'en-tête écarte un fichier qui n'est pas du SQLite
 * (une archive `.age` encore chiffrée, typiquement), et `PRAGMA integrity_check`
 * écarte une base tronquée par un téléchargement incomplet. Écraser la base de
 * production avec un fichier corrompu serait pire que l'absence de restauration.
 * @param candidatePath Chemin du fichier à valider.
 * @returns `null` si le fichier est valide, sinon le motif du rejet.
 */
export async function validateSqliteFile(candidatePath: string): Promise<string | null> {
  let header: Buffer;
  try {
    const handle = await fs.promises.open(candidatePath, "r");
    try {
      header = Buffer.alloc(SQLITE_MAGIC.length);
      await handle.read(header, 0, header.length, 0);
    } finally {
      await handle.close();
    }
  } catch (error) {
    return `fichier illisible (${(error as Error).message})`;
  }

  if (header.toString("latin1") !== SQLITE_MAGIC) {
    return "ce n'est pas une base SQLite (archive encore chiffrée ou fichier corrompu ?)";
  }

  try {
    // Lecture seule : sur une base laissée en mode WAL, une ouverture en
    // écriture déclencherait une récupération et modifierait le fichier que
    // l'on est justement en train de valider.
    const candidate = await open({
      filename: candidatePath,
      driver: sqlite3.Database,
      mode: sqlite3.OPEN_READONLY,
    });
    try {
      const row = await candidate.get<{ integrity_check: string }>("PRAGMA integrity_check");
      if (row?.integrity_check !== "ok") {
        return `base corrompue (${row?.integrity_check ?? "vérification impossible"})`;
      }
    } finally {
      await candidate.close();
    }
  } catch (error) {
    return `base illisible (${(error as Error).message})`;
  }

  return null;
}

/** Suffixe horodaté d'une copie de secours : `toISOString()` dont `:` et `.` sont devenus `-`. */
const ROLLBACK_STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;

/**
 * Relit la date d'écriture d'une copie de secours dans son nom.
 * @param name Nom de fichier (`database.sqlite.avant-<horodatage>`).
 * @param prefix Préfixe attendu (`database.sqlite.avant-`).
 * @returns L'instant en millisecondes, ou `null` si le nom ne porte pas d'horodatage lisible.
 */
export function rollbackTimestamp(name: string, prefix: string): number | null {
  if (!name.startsWith(prefix)) {
    return null;
  }
  const match = ROLLBACK_STAMP.exec(name.slice(prefix.length));
  if (!match) {
    return null;
  }
  const [, day, h, m, sec, ms] = match;
  const time = Date.parse(`${day}T${h}:${m}:${sec}.${ms}Z`);
  return Number.isNaN(time) ? null : time;
}

/**
 * Choisit les copies de secours à supprimer.
 *
 * Une copie est la base d'avant restauration, **en clair** : auteurs de scrims
 * non anonymisés, `UserLink`, configuration de serveurs quittés — tout ce que
 * les durées de conservation du bot n'atteignent pas dans ce fichier. Deux
 * règles, cumulées :
 *
 * - au-delà de `ROLLBACK_RETENTION_DAYS`, une copie part, quoi qu'il arrive ;
 * - après une restauration réussie (`keep` renseigné), toutes les copies
 *   précédentes partent. **Décision assumée** (minimisation, RGPD art. 5.1.e) :
 *   deux restaurations de suite perdent localement l'état d'avant la première,
 *   y compris ce qui a été écrit depuis la dernière sauvegarde chiffrée. Pour
 *   chercher la bonne archive sans ce risque, restaurer d'abord à la main sur
 *   une autre machine (`doc/backup-onedrive.md`, « À la main »).
 *
 * Un nom illisible n'est jamais retenu par la règle d'âge (on ne supprime pas
 * ce qu'on ne sait pas dater) — mais il l'est après une restauration réussie.
 * @param names Noms des fichiers du dossier de la base.
 * @param prefix Préfixe des copies (`database.sqlite.avant-`).
 * @param now Instant de référence, en millisecondes.
 * @param keep Nom de la copie à garder (celle de la restauration qui vient de réussir), ou `null` pour le seul ménage d'âge.
 * @returns Les noms à supprimer.
 */
export function selectExpiredRollbacks(
  names: string[],
  prefix: string,
  now: number,
  keep: string | null,
): string[] {
  const maxAge = ROLLBACK_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return names.filter((name) => {
    if (!name.startsWith(prefix) || name === keep) {
      return false;
    }
    if (keep !== null) {
      return true;
    }
    const time = rollbackTimestamp(name, prefix);
    return time !== null && now - time > maxAge;
  });
}

/**
 * Supprime les copies de secours périmées (voir `selectExpiredRollbacks`).
 *
 * Jouée après chaque restauration réussie (toutes les copies précédentes
 * partent) et chaque nuit par `runDataRetention` (seules les copies de plus de
 * `ROLLBACK_RETENTION_DAYS` partent). Ne lève jamais : une purge partielle
 * vaut mieux qu'un échec.
 * @param dbPath Chemin de la base de production.
 * @param keepPath Copie à garder (restauration qui vient de réussir) ; absente pour le seul ménage d'âge.
 * @param now Instant de référence, en millisecondes.
 * @returns Le nombre de copies supprimées.
 */
export async function purgeOldRollbacks(
  dbPath: string = resolveBddPath(),
  keepPath?: string,
  now: number = Date.now(),
): Promise<number> {
  const dir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.avant-`;

  try {
    const names = await fs.promises.readdir(dir);
    const obsolete = selectExpiredRollbacks(names, prefix, now, keepPath ? path.basename(keepPath) : null);

    let removed = 0;
    for (const name of obsolete) {
      const deleted = await fs.promises
        .unlink(path.join(dir, name))
        .then(() => true)
        .catch(() => false);
      if (deleted) {
        removed++;
      }
    }
    return removed;
  } catch {
    return 0;
  }
}

/**
 * Remplace la base SQLite du bot par une sauvegarde téléversée.
 *
 * La base courante est d'abord recopiée à côté : une restauration ratée reste
 * réversible. Cette copie est supprimée à la restauration réussie suivante, ou
 * au plus tard après `ROLLBACK_RETENTION_DAYS` (voir `purgeOldRollbacks`).
 * @param candidatePath Fichier de sauvegarde déjà validé et téléchargé.
 * @param dbPath Chemin de la base de production à remplacer.
 * @returns Le résultat de la restauration, message compris.
 */
export async function restoreDatabase(
  candidatePath: string,
  dbPath: string = resolveBddPath(),
): Promise<RestoreResult> {
  const invalid = await validateSqliteFile(candidatePath);
  if (invalid) {
    return {
      success: false,
      message: `Restauration refusée : ${invalid}`,
      summary: "Restauration refusée : la base extraite est illisible ou n'est pas une base SQLite saine.",
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rollbackPath = path.join(path.dirname(dbPath), `${path.basename(dbPath)}.avant-${stamp}`);

  // `copyFile` n'est pas atomique : une interruption en cours d'écriture laisse
  // une base tronquée. Le drapeau est donc posé avant la copie, pas après —
  // sinon le seul cas qu'il sert à rattraper serait justement exclu.
  let mayBeDamaged = false;

  try {
    // Le snapshot part avant toute fermeture : `VACUUM INTO` a besoin d'une
    // connexion vivante, et c'est le seul moyen d'obtenir une copie cohérente.
    if (fs.existsSync(dbPath)) {
      const bdd = await getBddInstance();
      await bdd.backupTo(rollbackPath);
    }

    // SQLite finalise ses requêtes et checkpointe le WAL en arrière-plan :
    // écraser le fichier sans attendre la fermeture laisserait l'ancienne
    // connexion flusher ses pages par-dessus la base restaurée.
    await resetBddInstance();
    mayBeDamaged = true;
    await fs.promises.copyFile(candidatePath, dbPath);

    // Les journaux de l'ancienne base décriraient des pages qui n'existent plus.
    await Promise.all(
      [`${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`].map((sidecar) =>
        fs.promises.unlink(sidecar).catch(() => {}),
      ),
    );

    // Rouvre immédiatement : le schéma est remis à niveau au passage, et une
    // base inutilisable est détectée ici plutôt qu'à la première commande.
    await getBddInstance();

    const purged = await purgeOldRollbacks(dbPath, rollbackPath);
    const purgedLine = purged > 0 ? ` ${purged} copie(s) précédente(s) supprimée(s).` : "";

    const message =
      `Base restaurée. L'ancienne version est conservée à côté du fichier ` +
      `(${ROLLBACK_RETENTION_DAYS} jours au plus, ou jusqu'à la prochaine restauration).${purgedLine}`;
    return { success: true, message, summary: message, rollbackPath };
  } catch (error) {
    await resetBddInstance().catch(() => {});

    // Une copie interrompue laisse une base tronquée : sans remise en état, le
    // bot repartirait dessus. La copie de secours n'est reposée que si l'on a
    // effectivement écrasé le fichier et qu'elle est elle-même exploitable —
    // un `VACUUM INTO` interrompu produirait sinon une seconde base corrompue.
    const recovered =
      mayBeDamaged && (await validateSqliteFile(rollbackPath)) === null
        ? await fs.promises
            .copyFile(rollbackPath, dbPath)
            .then(() => true)
            .catch(() => false)
        : false;

    // On rouvre dans tous les cas : le bot doit continuer de répondre.
    await getBddInstance().catch(() => {});

    const state = recovered
      ? " La base précédente a été remise en place."
      : " Vérifie l'état de la base avant de relancer le bot.";

    return {
      success: false,
      message: `Restauration échouée : ${(error as Error).message}.${state}`,
      summary: `Restauration échouée.${state}`,
      rollbackPath: fs.existsSync(rollbackPath) ? rollbackPath : undefined,
    };
  }
}
