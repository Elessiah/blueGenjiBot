import { MessageFlags, type Client, type User } from "discord.js";
import { formatDiskUsage, getDiskUsage } from "./diskSpace.js";
import { formatBackupStatus, isBackupFresh, readBackupStatus } from "./backupStatus.js";
import { resolveBddPath } from "../bdd/Bdd.js";
import { backupChecksPassed, formatBackupChecks, runBackupChecks, type BackupCheckReport } from "./backupCheck.js";

/**
 * Envoie au propriétaire (OWNER_ID) le rapport hebdomadaire de sauvegarde.
 *
 * La sauvegarde elle-même est faite par `scripts/backup-onedrive.sh`, en cron
 * système : les fichiers vivent sur le stockage distant, chiffrés, et ne transitent plus
 * par Discord — la pièce jointe plafonnait à 24 Mo et ne couvrait pas le MySQL
 * du site. Le bot se contente de relire le statut laissé par le script et
 * d'alerter si la sauvegarde manque ou date — puis de vérifier qu'elle **se
 * relit** (`backupCheck.ts` : déchiffrement en flux de la dernière archive,
 * miroir chiffré des images, clé publique à comparer à la copie hors ligne).
 * @param client Client Discord utilisé pour joindre le propriétaire.
 * @param runChecks Contrôles de relecture (remplaçables en test).
 * @returns `true` si le rapport a été envoyé, `false` sinon.
 */
export async function sendDatabaseBackup(
  client: Client,
  runChecks: () => Promise<BackupCheckReport> = runBackupChecks,
): Promise<boolean> {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId) {
    console.error("[backup] OWNER_ID non défini — rapport annulé.");
    return false;
  }

  const dbPath = resolveBddPath();
  const statusPath = process.env.BACKUP_STATUS_PATH || "/var/lib/bluegenji/backup-status.json";
  const stamp = new Date().toISOString().slice(0, 10);

  try {
    const status = await readBackupStatus(statusPath);
    const cloudLine = formatBackupStatus(status);
    // L'état du disque intéresse surtout quand la place manque : on le joint dans les deux cas.
    const diskLine = formatDiskUsage(await getDiskUsage(dbPath));
    // Une archive présente mais illisible ne vaut pas mieux qu'une absente.
    const checks = await runChecks();

    // Une sauvegarde absente ou périmée est la seule situation qui demande une
    // action : elle mérite d'être annoncée dès la première ligne du message.
    const healthy = isBackupFresh(status) && backupChecksPassed(checks);
    const header = healthy
      ? `🗄️ Rapport de sauvegarde BlueGenji — ${stamp}`
      : `🚨 Sauvegarde BlueGenji à vérifier — ${stamp}`;

    const owner: User = await client.users.fetch(ownerId);
    // Aucune mention ne notifie : le rapport cite des chemins et des sorties
    // de commandes, comme tout log.
    await owner.send({
      content: `${header}\n${cloudLine}\n${diskLine}\n\n${formatBackupChecks(checks)}`,
      allowedMentions: { parse: [] },
      // Rapport sain : un journal, en `@silent` (aucune notification).
      // Sauvegarde à vérifier : une alerte, qui notifie.
      ...(healthy ? { flags: MessageFlags.SuppressNotifications } : {}),
    });

    console.log(`[backup] Rapport hebdomadaire envoyé (${stamp}).`);
    return true;
  } catch (error) {
    console.error("[backup] Échec du rapport de sauvegarde :", (error as Error).message);
    return false;
  }
}
