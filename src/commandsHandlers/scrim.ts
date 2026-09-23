/**
 * Handler de `/scrim` : publie une recherche d'adversaire pour un match amical.
 *
 * Les recherches du bot (scrims, joueurs, staff) sont reservees a Marvel
 * Rivals : la commande n'offre donc plus de choix de jeu, elle enregistre
 * toujours `SCRIM_GAME`. La colonne `Scrim.game` reste, pour ne pas reecrire
 * les lignes anterieures ni le schema.
 *
 * Meme garde de module que `/recrute` : le module "scrims" doit etre actif
 * sur le serveur, sinon la commande refuse d'ecrire plutot que de laisser
 * s'accumuler des entrees qu'un admin a explicitement voulu desactiver.
 */

import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { recordEvent } from "@/feed/feedBus.js";
import { isModuleEnabled } from "@/modules/moduleGuard.js";

/** Seul jeu accepte par `/scrim`, tel que stocke dans `Scrim.game`. */
export const SCRIM_GAME = "marvel_rivals";
/** Nom affiche du jeu, dans la reponse et le flux d'activite. */
export const SCRIM_GAME_LABEL = "Marvel Rivals";

/**
 * @param client Client Discord, utilise pour le feed d'evenements et les logs.
 * @param interaction Interaction `/scrim` (option `niveau` requise).
 * @param guildId Serveur d'origine ; `null` en DM, auquel cas le module n'est pas verifie.
 */
export async function scrim(client: Client, interaction: ChatInputCommandInteraction, guildId: string | null): Promise<void> {
  try {
    const niveau = interaction.options.getString("niveau", true);
    if (guildId && !(await isModuleEnabled(guildId, "scrims"))) {
      await safeReply(interaction, "Le module Scrims est desactive sur ce serveur.", true, false);
      return;
    }
    const bdd = await getBddInstance();
    const status = await bdd.set("Scrim", ["id_author", "game", "level", "id_guild"], [interaction.user.id, SCRIM_GAME, niveau, guildId]);
    if (!status.success) {
      await safeReply(interaction, "Erreur lors de l'enregistrement du scrim.", true, false);
      return;
    }
    await recordEvent(client, "scrim", `Scrim ${SCRIM_GAME_LABEL} niveau ${niveau}`, interaction.guild?.name ?? null, null);
    await safeReply(interaction, `Recherche de scrim publiee : **${SCRIM_GAME_LABEL}** (${niveau}).`, false, false);
  } catch (err) {
    await sendLog(client, `scrim handler error: ${(err as Error).message}`);
  }
}
