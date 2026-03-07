import {Bdd, getBddInstance} from "@/bdd/Bdd.js";

import {defineRankRange} from "@/utils/defineRankRange.js";
import {setRankFilter} from "@/utils/setRankFilter.js";

import {sendLog} from "@/safe/sendLog.js";
import {safeReply} from "@/safe/safeReply.js";

import {checkPermissions} from "@/check/checkPermissions.js";

import {MessageFlags} from "discord.js";
import type {Client, ChatInputCommandInteraction, TextChannel} from "discord.js";


/**
 * Met à jour le filtre de rangs d'un salon partenaire.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 * @returns `true` si le filtre de rang est appliqué; `false` en cas de refus de permission, paramètres manquants ou erreur.
 */
async function setChannelRankFilter(client: Client,
                                    interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!checkPermissions(interaction)) {
        return await safeReply(interaction, "You don't have the permission to do that.", true);
    }
    try {
        await interaction.deferReply({flags: MessageFlags.Ephemeral});
        const bdd: Bdd = await getBddInstance();
        const channel: TextChannel = interaction.options.getChannel("channel") as TextChannel;
        const rank_min: string | null = interaction.options.getString("rank-min");
        const rank_max: string | null = interaction.options.getString("rank-max");
        console.log("channel: ", channel, "rank_min: ", rank_min, "rank_max: ", rank_max);
        if (!channel || !rank_min || !rank_max) {
            await safeReply(interaction, "At least one parameter is missing ! channel, rank_min or rank_max !", true, true);
            return false;
        }
        const channel_id: string = channel.id;
        const rank_range: number[] = await defineRankRange(rank_min, rank_max);
        await bdd.rm("ChannelPartnerRank", {}, {query: "id_channel = ?", values: [channel_id]});
        await setRankFilter(bdd, channel_id, rank_range);
        await safeReply(interaction, "Filter successfully added ! ", true, true);
        return true;
    } catch (e) {
        await sendLog(client, "Error while setting channel rank filter : " + (e as TypeError).message);
        await safeReply(interaction, "An error occurred while setting channel rank filter. Please try again !", true, true);
        return false;
    }
}

export {setChannelRankFilter};
