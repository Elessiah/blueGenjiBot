import fs from "node:fs";
import path from "node:path";
// eslint-disable-next-line import/no-named-as-default
import sqlite3 from "sqlite3";
import { open } from "sqlite";

import { getBddInstance, resetBddInstance } from "@/bdd/Bdd.js";

/** En-tête que tout fichier SQLite valide porte sur ses seize premiers octets. */
const SQLITE_MAGIC = "SQLite format 3\0";

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
    const candidate = await open({ filename: candidatePath, driver: sqlite3.Database });
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

  try {
    // Le snapshot part avant toute fermeture : `VACUUM INTO` a besoin d'une
    // connexion vivante, et c'est le seul moyen d'obtenir une copie cohérente.
    if (fs.existsSync(dbPath)) {
      const bdd = await getBddInstance();
      await bdd.backupTo(rollbackPath);
    }

    // SQLite garde le fichier ouvert : sans fermeture, la copie serait écrasée
    // sous les pieds d'une connexion encore active.
    resetBddInstance();
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

    return {
      success: true,
      message: "Base restaurée. L'ancienne version est conservée à côté du fichier.",
      rollbackPath,
    };
  } catch (error) {
    // La base courante peut être à moitié écrasée : on rouvre pour que le bot
    // continue de répondre, et on laisse le fichier de secours au propriétaire.
    resetBddInstance();
    await getBddInstance().catch(() => {});

    return {
      success: false,
      message: `Restauration échouée : ${(error as Error).message}`,
      rollbackPath: fs.existsSync(rollbackPath) ? rollbackPath : undefined,
    };
  }
}
