import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageFlags, type ChatInputCommandInteraction, type Client } from "discord.js";

import { restoreDatabase } from "@/backup/restoreDatabase.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";

// Garde-fou mémoire : le fichier est tamponné avant écriture, et une base saine
// du bot pèse quelques mégaoctets. Discord plafonne déjà bien en dessous.
const MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

/**
 * Restaure la base SQLite du bot à partir d'un fichier joint à la commande.
 *
 * Réservée au propriétaire déclaré dans `OWNER_ID` : la commande écrase la base
 * de production, aucun rôle Discord ne suffit à l'autoriser.
 * @param client Client Discord, pour la journalisation.
 * @param interaction Interaction `/restore-backup` en cours.
 * @returns Rien ; la réponse part par `safeReply`.
 */
export async function restoreBackup(
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    await safeReply(interaction, "❌ Commande réservée au propriétaire du bot.");
    return;
  }

  if (!interaction.options.getBoolean("confirmer")) {
    await safeReply(
      interaction,
      "❌ Restauration annulée : relance la commande avec `confirmer: true`. " +
        "Elle remplace la base de production en cours d'utilisation.",
    );
    return;
  }

  const attachment = interaction.options.getAttachment("fichier", true);
  if (attachment.size > MAX_UPLOAD_SIZE) {
    await safeReply(interaction, "❌ Fichier trop volumineux pour être restauré.");
    return;
  }

  if (attachment.name.endsWith(".age")) {
    await safeReply(
      interaction,
      "❌ Cette archive est encore chiffrée. Déchiffre-la d'abord :\n" +
        "```bash\nage --decrypt -i ~/.bluegenji-backup.key sauvegarde.tar.age | tar -x\n```\n" +
        "puis glisse le `database.sqlite` obtenu.",
    );
    return;
  }

  // Le téléchargement et la validation dépassent les 3 s d'une interaction.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const tmpPath = path.join(os.tmpdir(), `bluegenji-restore-${Date.now()}.sqlite`);

  try {
    const response = await fetch(attachment.url);
    if (!response.ok) {
      await safeReply(interaction, `❌ Téléchargement impossible (HTTP ${response.status}).`, true, true);
      return;
    }

    await fs.promises.writeFile(tmpPath, Buffer.from(await response.arrayBuffer()));

    const result = await restoreDatabase(tmpPath);
    const rollback = result.rollbackPath ? `\nSauvegarde de l'ancienne base : \`${result.rollbackPath}\`` : "";

    await safeReply(interaction, `${result.success ? "✅" : "❌"} ${result.message}${rollback}`, true, true);
    await sendLog(
      client,
      `Restauration de la base par ${interaction.user.tag} (${attachment.name}) : ` +
        `${result.success ? "succès" : "échec"} — ${result.message}`,
    );
  } catch (error) {
    await safeReply(interaction, `❌ Restauration échouée : ${(error as Error).message}`, true, true);
    await sendLog(client, `Restauration de la base échouée : ${(error as Error).message}`);
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => {});
  }
}
