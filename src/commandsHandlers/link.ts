/**
 * Handler de `/link` : genere un code de liaison entre le compte Discord et le compte du site BlueGenji.
 *
 * Le code passe par un DM plutot que par la reponse a la commande : c'est un
 * secret court duree, et un DM garantit que seul l'utilisateur qui a tape la
 * commande peut le lire, meme si la commande a ete lancee dans un salon
 * public. Le site l'associe ensuite au compte via l'API interne.
 */

import { randomInt } from "node:crypto";

import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { recordEvent } from "@/feed/feedBus.js";

/**
 * @param client Client Discord, utilise pour envoyer le DM et journaliser.
 * @param interaction Interaction `/link` a laquelle repondre.
 */
export async function link(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    // Un code de liaison est un secret d'authentification, et `Math.random`
    // n'en produit pas : son etat interne se reconstitue a partir de quelques
    // tirages consecutifs. Or la commande est ouverte a tous, donc n'importe
    // qui peut echantillonner la suite en enchainant `/link` avant de
    // demander celui d'un autre compte. `randomInt` tire du CSPRNG du noyau.
    const code = String(randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const bdd = await getBddInstance();
    await bdd.raw("INSERT INTO UserLink (id_user, code, expires_at, linked_at) VALUES (?, ?, ?, NULL) ON CONFLICT(id_user) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, linked_at = NULL", [interaction.user.id, code, expiresAt]);
    try {
      await interaction.user.send(`BlueGenji Arena - Code de liaison : **${code}** (valide 10 minutes). Entrez-le sur le site pour lier votre compte Discord.`);
      await safeReply(interaction, "Code envoye en message prive. Verifiez vos DM.", true, false);
      await recordEvent(client, "auth", "Code /link envoye a un joueur");
    } catch {
      await safeReply(interaction, "Impossible d'envoyer le DM. Activez les messages prives du serveur dans vos parametres Discord.", true, false);
    }
  } catch (err) {
    await sendLog(client, `link handler error: ${(err as Error).message}`);
  }
}
