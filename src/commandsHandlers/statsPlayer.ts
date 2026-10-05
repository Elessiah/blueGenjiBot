/**
 * Handler de `/stats` : recapitule l'activite recente de l'utilisateur qui tape la commande.
 *
 * Compte messages partenaires, propositions de scrim et recherches publiees
 * — les trois signaux d'activite que le bot suit deja pour ses propres
 * besoins de moderation, redonnes ici au joueur pour transparence.
 *
 * **Soi-meme seulement** : la commande acceptait un autre utilisateur, si bien
 * que n'importe qui lisait l'activite de n'importe qui. Elle n'a plus d'option.
 *
 * **Chaque compteur annonce sa vraie fenetre** : la reponse disait « 30j » pour
 * les trois, alors que les messages relayes sont purges au bout de
 * `MESSAGE_RETENTION_DAYS` — le compteur de messages ne pouvait pas voir plus
 * loin. Les fenetres sont donc lues sur les durees de conservation elles-memes.
 */

import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "../safe/safeReply.js";
import { sendLog } from "../safe/sendLog.js";
import { getBddInstance } from "../bdd/Bdd.js";
import { ACTIVITY_AUTHOR_RETENTION_DAYS, MESSAGE_RETENTION_DAYS } from "../privacy/retentionPeriods.js";

/**
 * Redige la reponse de `/stats`.
 * @param counts Compteurs de l'utilisateur.
 * @returns Le message, chaque ligne portant sa fenetre.
 */
export function formatPlayerStats(counts: { messages: number; scrims: number; recherches: number }): string {
  return [
    "Ton activite recente sur le bot",
    `- Messages partenaires (${MESSAGE_RETENTION_DAYS} derniers jours) : ${counts.messages}`,
    `- Scrims proposes (${ACTIVITY_AUTHOR_RETENTION_DAYS} derniers jours) : ${counts.scrims}`,
    `- Recherches (${ACTIVITY_AUTHOR_RETENTION_DAYS} derniers jours) : ${counts.recherches}`,
  ].join("\n");
}

/**
 * @param client Client Discord.
 * @param interaction Interaction `/stats` ; la cible est toujours son auteur.
 */
export async function statsPlayer(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const userId = interaction.user.id;
    const bdd = await getBddInstance();
    const since = (days: number) => ({ query: "id_author = ? AND date >= datetime('now', ?)", values: [userId, `-${days} days`] });
    const msgRows = await bdd.get("OGMsg", ["COUNT(*) AS total"], {}, since(MESSAGE_RETENTION_DAYS)) as { total: number }[];
    const scrimRows = await bdd.get("Scrim", ["COUNT(*) AS total"], {}, since(ACTIVITY_AUTHOR_RETENTION_DAYS)) as { total: number }[];
    const recruteRows = await bdd.get("Recrute", ["COUNT(*) AS total"], {}, since(ACTIVITY_AUTHOR_RETENTION_DAYS)) as { total: number }[];
    const msg = formatPlayerStats({
      messages: Number(msgRows[0]?.total ?? 0),
      scrims: Number(scrimRows[0]?.total ?? 0),
      recherches: Number(recruteRows[0]?.total ?? 0),
    });
    await safeReply(interaction, msg, true, false);
  } catch (err) {
    await sendLog(client, `statsPlayer handler error: ${(err as Error).message}`);
  }
}
