import {sendLog} from "../../safe/sendLog.js";
import {safeReply} from "../../safe/safeReply.js";

import {Bdd, getBddInstance} from "../../bdd/Bdd.js";

import {formatRawRanks} from "../../utils/formatRawRanks.js";

import {ChatInputCommandInteraction, Client, Channel, MessageFlags, TextChannel} from "discord.js";

async function displayChannelRankFilter(client: Client,
                                        interaction: ChatInputCommandInteraction): Promise<boolean> {
    try {
        await interaction.deferReply({flags: MessageFlags.Ephemeral});
        const channel: TextChannel | null = interaction.options.getChannel("channel") as TextChannel | null;
        if (!channel) {
            await safeReply(interaction, "Channel is missing !", true);
            return false;
        }
        const channel_id: string = channel.id;
        const bdd: Bdd = await getBddInstance();
        const result_request: {name: string}[] = await bdd.get(
            "Ranks",
            ["name"],
            {"ChannelPartnerRank": "ChannelPartnerRank.id_rank = Ranks.id_rank"},
            {query: "ChannelPartnerRank.id_channel = ?", values: [channel_id]}
        ) as {name: string}[];
        if (!result_request || result_request.length === 0) {
            await safeReply(interaction, "This channel is not connected to any services ! ", true, true);
        } else {
            const covered_ranks: string[] = result_request.map(obj => Object.values(obj)).flat();
            const formated_ranks = await formatRawRanks(covered_ranks);
            await safeReply(interaction, "This channel will receive ads concerning these ranks :\n" + formated_ranks, true, true);
        }
        return true;
    } catch (e) {
        await sendLog(client, "Error while displaying channel rank filter : " + e);
        await safeReply(interaction, "An error occurred, please try again", true, true);
        return false;
    }
}

export {displayChannelRankFilter};