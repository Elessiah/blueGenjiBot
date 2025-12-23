import { sendLog } from "../../safe/sendLog.js";
import { safeReply } from "../../safe/safeReply.js";
import { getBddInstance } from "../../bdd/Bdd.js";
import { formatRawRanks } from "../../utils/formatRawRanks.js";
import { MessageFlags } from "discord.js";
async function displayChannelRankFilter(client, interaction) {
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const channel = interaction.options.getChannel("channel");
        if (!channel) {
            await safeReply(interaction, "Channel is missing !", true);
            return false;
        }
        const channel_id = channel.id;
        const bdd = await getBddInstance();
        const result_request = await bdd.get("Ranks", ["name"], { "ChannelPartnerRank": "ChannelPartnerRank.id_rank = Ranks.id_rank" }, { query: "ChannelPartnerRank.id_channel = ?", values: [channel_id] });
        if (!result_request || result_request.length === 0) {
            await safeReply(interaction, "This channel is not connected to any services ! ", true, true);
        }
        else {
            const covered_ranks = result_request.map(obj => Object.values(obj)).flat();
            const formated_ranks = await formatRawRanks(covered_ranks);
            await safeReply(interaction, "This channel will receive ads concerning these ranks :\n" + formated_ranks, true, true);
        }
        return true;
    }
    catch (e) {
        await sendLog(client, "Error while displaying channel rank filter : " + e);
        await safeReply(interaction, "An error occurred, please try again", true, true);
        return false;
    }
}
export { displayChannelRankFilter };
//# sourceMappingURL=displayChannelRankFilter.js.map