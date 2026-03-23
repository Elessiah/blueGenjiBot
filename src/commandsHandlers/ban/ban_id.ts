import type {APIInteractionDataResolvedGuildMember, ChatInputCommandInteraction, Client, GuildMember} from "discord.js";

import {ban} from "./ban.js";

import {safeReply} from "@/safe/safeReply.js";

/**
 * Ban un utilisateur des services du bot discord à partir d'un id
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 * @returns `false` si utilisateur/raison manquants; sinon relaie le résultat de `ban`.
 */
async function ban_id(client: Client,
                      interaction: ChatInputCommandInteraction): Promise<boolean> {
    const user: GuildMember | APIInteractionDataResolvedGuildMember | null = interaction.options.getMember("user");
    const reason: string | null = interaction.options.getString("reason");
    if (!user || !reason || !("user" in user)) {
        await safeReply(interaction, "Missing one or more parameter. Please try again.");
        return false;
    }
    return await ban(client, interaction, user.user, reason);
}

export {ban_id};
