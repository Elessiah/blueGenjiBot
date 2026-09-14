/**
 * Handler de `/show-bot-admin` : affiche le role admin du bot configure pour ce serveur.
 *
 * Lecture seule, ouverte a tous : contrairement a `/set-bot-admin`, connaitre
 * le role en place ne presente aucun risque et evite d'obliger un membre a
 * demander a un admin quel role verifier avec `checkAdminRole`.
 */

import {ChatInputCommandInteraction, Client} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";

/**
 * @param client Client Discord (non utilise directement, garde pour la signature commune des handlers).
 * @param interaction Interaction `/show-bot-admin`, doit venir d'un serveur.
 */
async function showBotAdminRole(client: Client,
                                interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await safeReply(interaction, "There is no admin role outside discord server.");
        return;
    }
    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get("RoleAdmin", ["role_id"], undefined, {query: "guild_id = ?", values: [interaction.guild.id]});
    if (result.length == 0) {
        await safeReply(interaction, "There is no admin role on this discord server.");
        return;
    }
    const role: {role_id: string} = result[0] as {role_id: string};
    await safeReply(interaction, "The admin role for the bot is <@&" + role.role_id + ">");
}

export {showBotAdminRole};
