import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AttachmentBuilder, type Client, type User } from "discord.js";
import { getBddInstance } from "@/bdd/Bdd.js";

// Limite de taille d'une pièce jointe pour un bot sans Nitro (marge sous les 25 Mo).
const MAX_ATTACHMENT_SIZE = 24 * 1024 * 1024;

/**
 * Crée un snapshot cohérent de la base SQLite et l'envoie en message privé
 * au propriétaire (OWNER_ID) en pièce jointe, pour la sauvegarde hebdomadaire.
 * @param client Client Discord utilisé pour joindre le propriétaire.
 * @returns `true` si la sauvegarde a été envoyée, `false` sinon.
 */
export async function sendDatabaseBackup(client: Client): Promise<boolean> {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) {
    console.error("[backup] OWNER_ID non défini — sauvegarde annulée.");
    return false;
  }

  const dbPath = process.env.BDD_PATH || "./database.sqlite";
  const stamp = new Date().toISOString().slice(0, 10);
  const snapshotPath = path.join(os.tmpdir(), `bluegenji-backup-${stamp}.sqlite`);

  try {
    if (!fs.existsSync(dbPath)) {
      console.error(`[backup] Base introuvable (${dbPath}) — sauvegarde annulée.`);
      return false;
    }

    // Snapshot cohérent (évite une copie corrompue si une écriture est en cours).
    const bdd = await getBddInstance();
    await bdd.backupTo(snapshotPath);

    const owner: User = await client.users.fetch(ownerId);
    const size = (await fs.promises.stat(snapshotPath)).size;

    if (size > MAX_ATTACHMENT_SIZE) {
      await owner.send(
        `⚠️ Sauvegarde hebdomadaire impossible via Discord : la base fait ` +
          `${(size / 1024 / 1024).toFixed(1)} Mo (> 24 Mo). Prévoir une autre méthode de sauvegarde.`,
      );
      return false;
    }

    const attachment = new AttachmentBuilder(snapshotPath, {
      name: `database-${stamp}.sqlite`,
    });
    await owner.send({
      content: `🗄️ Sauvegarde hebdomadaire de la base BlueGenji — ${stamp}`,
      files: [attachment],
    });

    console.log(`[backup] Sauvegarde envoyée au propriétaire (${stamp}).`);
    return true;
  } catch (error) {
    console.error("[backup] Échec de la sauvegarde :", (error as Error).message);
    return false;
  } finally {
    await fs.promises.unlink(snapshotPath).catch(() => {});
  }
}
