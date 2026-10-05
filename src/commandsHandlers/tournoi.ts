/**
 * Handler de `/tournoi` : publie les liens du tournoi BlueGenji (règlement
 * en français et en anglais, formulaire pour caster).
 *
 * Ouverte à tous, réponse visible du salon : elle sert à donner les liens à
 * une équipe ou à un caster sans les recopier.
 */

import type { ChatInputCommandInteraction, Client } from "discord.js";

import { getBddInstance } from "../bdd/Bdd.js";
import { safeReply } from "../safe/safeReply.js";
import { sendLog } from "../safe/sendLog.js";
import { formatTournamentLinks, resolveTournamentLinks } from "../tournament/tournamentLinks.js";

/**
 * @param client Client Discord, utilisé pour journaliser une erreur.
 * @param interaction Interaction `/tournoi` à laquelle répondre.
 */
export async function tournoi(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    let stored: Record<string, string> = {};
    try {
        stored = await (await getBddInstance()).getTournamentLinks();
    } catch (err) {
        // Base illisible : les liens par défaut valent mieux qu'aucune réponse.
        await sendLog(client, `tournoi: lecture des liens impossible : ${(err as Error).message}`);
    }
    await safeReply(interaction, formatTournamentLinks(resolveTournamentLinks(stored)), false);
}
