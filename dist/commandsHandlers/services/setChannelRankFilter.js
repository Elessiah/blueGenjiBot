import { getBddInstance } from "../../bdd/Bdd.js";
import { defineRankRange } from "../../utils/defineRankRange.js";
import { setRankFilter } from "../../utils/setRankFilter.js";
import { sendLog } from "../../safe/sendLog.js";
import { safeReply } from "../../safe/safeReply.js";
import { checkPermissions } from "../../check/checkPermissions.js";
import { MessageFlags } from "discord.js";
async function setChannelRankFilter(client, interaction) {
    if (!await checkPermissions(interaction)) {
        return await safeReply(interaction, "You don't have the permission to do that.", true);
    }
    try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const bdd = await getBddInstance();
        const channel = interaction.options.getChannel("channel");
        const rank_min = interaction.options.getString("rank_min");
        const rank_max = interaction.options.getString("rank_max");
        if (!channel || !rank_min || !rank_max) {
            await safeReply(interaction, "At least one parameter is missing ! channel, rank_min or rank_max !", true, true);
            return false;
        }
        const channel_id = channel.id;
        const rank_range = await defineRankRange(rank_min, rank_max);
        await bdd.rm("ChannelPartnerRank", {}, { query: "id_channel = ?", values: [channel_id] });
        await setRankFilter(bdd, channel_id, rank_range);
        await safeReply(interaction, "Filter successfully added ! ", true, true);
        return true;
    }
    catch (e) {
        await sendLog(client, "Error while setting channel rank filter : " + e.message);
        await safeReply(interaction, "An error occurred while setting channel rank filter. Please try again !", true, true);
        return false;
    }
}
export { setChannelRankFilter };
//# sourceMappingURL=setChannelRankFilter.js.map