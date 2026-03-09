import {
    type ChatInputCommandInteraction,
    type Client,
    MessageFlags,
    TextChannel
} from "discord.js";

import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {sendLog} from "@/safe/sendLog.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {safeReply} from "@/safe/safeReply.js";

/**
 * Configure la liste des services autorisés pour un salon.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 * @returns `true` quand la commande est traitée (inchangée ou mise à jour), `false` uniquement si région absente ou en cas d'exception.
 */
async function setChannelFilter(client: Client,
                                interaction: ChatInputCommandInteraction): Promise<boolean> {
    try {
        if (!(await checkPermissions(interaction))) {
            await safeReply(interaction, "You don't have the permission to edit channel filter.");
            return true;
        }
        await interaction.deferReply({flags: MessageFlags.Ephemeral});
        const bdd: Bdd = await getBddInstance();
        const channel: TextChannel | null = interaction.options.getChannel("channel") as TextChannel | null;
        if (!channel) {
            await safeReply(interaction, "Missing channel in command parameters.");
            return true;
        }
        const channel_id: string = channel.id;
        const region: number | null = interaction.options.getInteger("region");
        if (!region) {
            await safeReply(interaction, "Missing region in command parameters.");
            return false;
        }
        const current_filter: {region: number}[] = await bdd.get("ChannelPartner", ["region"], {}, {query: "id_channel = ?", values: [channel_id]}) as {region: number}[];
        if (current_filter == null || current_filter.length === 0) {
            await safeReply(interaction, "This channel is not link to any service", true, true);
            return true;
        }
        if (current_filter[0].region === region) {
            await safeReply(interaction, "This filter is already active !", true, true);
            return true;
        }
        await bdd.update("ChannelPartner", {region: region}, {id_channel: channel_id});
        await safeReply(interaction, "The channel filter has been updated!", true, true);
        return true;
    } catch (e) {
        await safeReply(interaction,"An error occurred while trying to edit channel filter. Please try again or contact : elessiah. Error : " + (e as TypeError).message, true, true);
        await sendLog(client, "Error while trying to edit channel filter : " + (e as TypeError).message);
        return false;
    }
}

export {setChannelFilter};
