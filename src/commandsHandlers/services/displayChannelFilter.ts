import {sendLog} from "@/safe/sendLog.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {safeReply} from "@/safe/safeReply.js";
import {regions} from "@/utils/globals.js";
import type {Channel, ChatInputCommandInteraction, Client} from "discord.js";

/**
 * Affiche le filtre de services actuellement configuré pour un salon.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function displayChannelFilter(client: Client, interaction: ChatInputCommandInteraction) {
    try {
        const bdd: Bdd = await getBddInstance();
        const channel: Channel | null = interaction.options.getChannel("channel") as Channel | null;
        if (!channel) {
            await safeReply(interaction, "Channel not found in the options!");
            return;
        }
        const channel_id: string = channel.id;
        let region: {region: number}[] = await bdd.get("ChannelPartner", ["region"], {}, {query: "id_channel = ?", values: [channel_id]}) as {region: number}[];
        if (region.length === 0) {
            await safeReply(interaction, "This channel is not connected to any service.");
        } else {
            const id_region: number = region[0].region;
            await safeReply(interaction, `The filter of this channel is : **${regions[id_region]}**.`);
        }
    } catch (e) {
        await safeReply(interaction, "An error occurred while trying to display channel filter.");
        await sendLog(client, "Error while displaying channel filter : " + (e as TypeError).message);
    }
}

export {displayChannelFilter};
