import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line import/no-named-as-default
import sqlite3 from "sqlite3";
import { open } from "sqlite";

import { getBddInstance, resetBddInstance } from "@/bdd/Bdd.js";

/** En-tête que tout fichier SQLite valide porte sur ses seize premiers octets. */
const SQLITE_MAGIC = "SQLite format 3\0";

/** Nombre de copies de secours conservées après une restauration réussie. */
export const KEPT_ROLLBACKS = 3;

/** Résultat d'une tentative de restauration. */
export interface RestoreResult {
  /** `true` si la base courante a bien été remplacée. */
  success: boolean;
  /** Message destiné au propriétaire, en français. */
  message: string;
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

/**
 * Supprime les copies de secours les plus anciennes, au-delà de `KEPT_ROLLBACKS`.
 *
 * Chaque restauration recopie intégralement la base : sans purge, chercher la
 * bonne sauvegarde parmi plusieurs remplit le disque du Raspberry — celui-là
 * même que le rapport hebdomadaire surveille.
 * @param dbPath Chemin de la base de production.
 * @returns Le nombre de copies supprimées.
 */
export async function purgeOldRollbacks(dbPath: string): Promise<number> {
  const dir = path.dirname(dbPath);
  const prefix = `${path.basename(dbPath)}.avant-`;

  try {
    const entries = (await fs.promises.readdir(dir)).filter((name) => name.startsWith(prefix));
    // L'horodatage ISO du suffixe est trié lexicographiquement comme chronologiquement.
    const obsolete = entries.sort().slice(0, Math.max(0, entries.length - KEPT_ROLLBACKS));

    let removed = 0;
    for (const name of obsolete) {
      // Une purge partielle vaut mieux qu'un échec : la restauration, elle, a réussi.
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
 * réversible, et le fichier de secours n'est jamais supprimé automatiquement.
 * @param candidatePath Fichier de sauvegarde déjà validé et téléchargé.
 * @param dbPath Chemin de la base de production à remplacer.
 * @returns Le résultat de la restauration, message compris.
 */
export async function restoreDatabase(
  candidatePath: string,
  dbPath: string = process.env.BDD_PATH || "./database.sqlite",
): Promise<RestoreResult> {
  const invalid = await validateSqliteFile(candidatePath);
  if (invalid) {
    return { success: false, message: `Restauration refusée : ${invalid}` };
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

    const purged = await purgeOldRollbacks(dbPath);
    const purgedLine = purged > 0 ? ` ${purged} copie(s) plus ancienne(s) supprimée(s).` : "";

    return {
      success: true,
      message: `Base restaurée. L'ancienne version est conservée à côté du fichier.${purgedLine}`,
      rollbackPath,
    };
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
      rollbackPath: fs.existsSync(rollbackPath) ? rollbackPath : undefined,
    };
  }
}
