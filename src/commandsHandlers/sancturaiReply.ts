/**
 * Handler de `/sancturai-reply` : renvoie à SancturAI la réponse de
 * l'administrateur à un message d'agent. Réservé au propriétaire (`OWNER_ID`).
 */

import { MessageFlags, type ChatInputCommandInteraction, type Client } from "discord.js";
import { safeReply } from "../safe/safeReply.js";
import { sendLog } from "../safe/sendLog.js";
import { parseReplyArgs, postReply } from "../internalApi/sancturai.js";

/**
 * @param client Client Discord (journal d'erreurs).
 * @param interaction Interaction `/sancturai-reply` (options `id` et `texte`).
 */
export async function sancturaiReply(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const ownerId = process.env.OWNER_ID;
    if (!ownerId || interaction.user.id !== ownerId) {
      await safeReply(interaction, "Commande réservée au propriétaire.", true, false);
      return;
    }
    // L'appel à SancturAI peut durer jusqu'à son délai (10 s) : Discord n'attend que 3 s sans accusé.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const args = parseReplyArgs(interaction.options.getString("id", true), interaction.options.getString("texte", true));
    const url = process.env.SANCTURAI_INTERNAL_URL;
    const token = process.env.SANCTURAI_INTERNAL_TOKEN;
    if (!args || !url || !token) {
      await safeReply(interaction, "Arguments invalides ou SancturAI non configuré.", true, true);
      return;
    }
    const status = await postReply(url, token, args.shortId, args.text);
    await safeReply(interaction, status === 200 ? `Réponse envoyée à #${args.shortId}.`
      : `Échec (${status}) : fil inconnu ou SancturAI indisponible.`, true, true);
  } catch (err) {
    await sendLog(client, `sancturaiReply error: ${(err as Error).message}`);
    // Après deferReply, sans réponse l'interaction reste « réfléchit… » puis échoue.
    if (interaction.deferred) await safeReply(interaction, "SancturAI injoignable.", true, true);
  }
}
