/**
 * Handler de `/stats` : recapitule l'activite 30 jours d'un joueur (soi-meme par defaut).
 *
 * Compte messages partenaires, propositions de scrim et recherches publiees
 * — les trois signaux d'activite que le bot suit deja pour ses propres
 * besoins de moderation, redonnes ici au joueur pour transparence.
 */

import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { getBddInstance } from "@/bdd/Bdd.js";

/**
 * @param client Client Discord.
 * @param interaction Interaction `/stats` ; l'option `joueur` est optionnelle, l'auteur de la commande sert de cible par defaut.
 */
export async function statsPlayer(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const targetUser = interaction.options.getUser("joueur", false) ?? interaction.user;
    const bdd = await getBddInstance();
    const msgRows = await bdd.get("OGMsg", ["COUNT(*) AS total"], {}, { query: "id_author = ? AND date >= datetime('now', '-30 day')", values: [targetUser.id] }) as { total: number }[];
    const scrimRows = await bdd.get("Scrim", ["COUNT(*) AS total"], {}, { query: "id_author = ? AND date >= datetime('now', '-30 day')", values: [targetUser.id] }) as { total: number }[];
    const recruteRows = await bdd.get("Recrute", ["COUNT(*) AS total"], {}, { query: "id_author = ? AND date >= datetime('now', '-30 day')", values: [targetUser.id] }) as { total: number }[];
    const msg = `Stats 30j de ${targetUser.username}\n- Messages partenaires : ${Number(msgRows[0]?.total ?? 0)}\n- Scrims proposes : ${Number(scrimRows[0]?.total ?? 0)}\n- Recherches : ${Number(recruteRows[0]?.total ?? 0)}`;
    await safeReply(interaction, msg, true, false);
  } catch (err) {
    await sendLog(client, `statsPlayer handler error: ${(err as Error).message}`);
  }
}
