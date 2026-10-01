import { MessageFlags, type ChatInputCommandInteraction, type Client } from "discord.js";

import { formatBackupChecks, runBackupChecks, type BackupCheckReport } from "@/backup/backupCheck.js";
import { safeReply } from "@/safe/safeReply.js";

/**
 * Joue à la demande les contrôles du rapport hebdomadaire de sauvegarde
 * (`backup/backupCheck.ts`) : déchiffrement en flux de la dernière archive,
 * lecture du miroir chiffré des images, clé publique à comparer à la copie
 * hors ligne.
 *
 * Réservée au propriétaire déclaré dans `OWNER_ID`, comme `/restore-backup` :
 * elle manipule la clé privée des sauvegardes, aucun rôle Discord ne suffit.
 * Réponse éphémère, différée — le déchiffrement d'une archive dépasse les
 * 3 s d'une interaction.
 * @param _client Client Discord (inutilisé, signature commune des commandes).
 * @param interaction Interaction `/backup-check` en cours.
 * @returns Rien ; la réponse part par `safeReply`.
 */
export async function backupCheck(_client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  await answerBackupCheck(interaction, () => runBackupChecks());
}

/**
 * Corps de `/backup-check`, contrôles injectés. Séparé du gestionnaire : le
 * registre des commandes passe un troisième argument (l'identifiant du
 * serveur), qui ne doit pas tomber dans un paramètre facultatif.
 * @param interaction Interaction en cours.
 * @param run Contrôles à jouer.
 * @returns Rien ; la réponse part par `safeReply`.
 */
export async function answerBackupCheck(
  interaction: ChatInputCommandInteraction,
  run: () => Promise<BackupCheckReport>,
): Promise<void> {
  const ownerId = process.env.OWNER_ID;
  if (!ownerId || interaction.user.id !== ownerId) {
    await safeReply(interaction, "❌ Commande réservée au propriétaire du bot.");
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    await safeReply(interaction, formatBackupChecks(await run()), true, true);
  } catch (error) {
    // Les contrôles rendent leurs échecs ; une exception ici est imprévue, et
    // son message peut nommer un chemin : il reste au journal.
    console.error("[backup-check] Échec imprévu :", (error as Error).message);
    await safeReply(interaction, "❌ Vérification impossible — voir le journal du bot.", true, true);
  }
}
