import { type Client, type User } from "discord.js";
import { formatDiskUsage, getDiskUsage } from "@/backup/diskSpace.js";
import { formatBackupStatus, isBackupFresh, readBackupStatus } from "@/backup/backupStatus.js";

/**
 * Envoie au propriétaire (OWNER_ID) le rapport hebdomadaire de sauvegarde.
 *
 * La sauvegarde elle-même est faite par `scripts/backup-onedrive.sh`, en cron
 * système : les fichiers vivent sur OneDrive, chiffrés, et ne transitent plus
 * par Discord — la pièce jointe plafonnait à 24 Mo et ne couvrait pas le MySQL
 * du site. Le bot se contente de relire le statut laissé par le script et
 * d'alerter si la sauvegarde manque ou date.
 * @param client Client Discord utilisé pour joindre le propriétaire.
 * @returns `true` si le rapport a été envoyé, `false` sinon.
 */
export async function sendDatabaseBackup(client: Client): Promise<boolean> {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) {
    console.error("[backup] OWNER_ID non défini — rapport annulé.");
    return false;
  }

  const dbPath = process.env.BDD_PATH || "./database.sqlite";
  const statusPath = process.env.BACKUP_STATUS_PATH || "/var/lib/bluegenji/backup-status.json";
  const stamp = new Date().toISOString().slice(0, 10);

  try {
    const status = await readBackupStatus(statusPath);
    const cloudLine = formatBackupStatus(status);
    // L'état du disque intéresse surtout quand la place manque : on le joint dans les deux cas.
    const diskLine = formatDiskUsage(await getDiskUsage(dbPath));

    // Une sauvegarde absente ou périmée est la seule situation qui demande une
    // action : elle mérite d'être annoncée dès la première ligne du message.
    const header = isBackupFresh(status)
      ? `🗄️ Rapport de sauvegarde BlueGenji — ${stamp}`
      : `🚨 Sauvegarde BlueGenji à vérifier — ${stamp}`;

    const owner: User = await client.users.fetch(ownerId);
    await owner.send(`${header}\n${cloudLine}\n${diskLine}`);

    console.log(`[backup] Rapport hebdomadaire envoyé (${stamp}).`);
    return true;
  } catch (error) {
    console.error("[backup] Échec du rapport de sauvegarde :", (error as Error).message);
    return false;
  }
}
