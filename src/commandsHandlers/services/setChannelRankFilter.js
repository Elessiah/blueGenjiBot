const {getBddInstance} = require("../../bdd/Bdd");
const sendLog = require("../../safe/sendLog");
const defineRankRange = require("../../utils/defineRankRange");
const setRankFilter = require("../../utils/setRankFilter");
const safeReply = require("../../safe/safeReply");
const checkPermissions = require("../../check/checkPermissions");

async function setChannelRankFilter(client, interaction) {
    if (!await checkPermissions(interaction)) {
        return await safeReply(interaction, "You don't have the permission to do this.", true);
    }
    try {
        await interaction.deferReply({ephemeral: true});
        const bdd = await getBddInstance();
        if (!bdd) {
            return await sendLog(client, "Bdd failed in NewChannelPartner!");
        }
        const channel_id = interaction.options.getChannel("channel").id;
        const rank_range = await defineRankRange(interaction.options.getString("rank-min"), interaction.options.getString("rank-max"));
        await bdd.rm("ChannelPartnerRank", {}, {id_channel: channel_id});
        await setRankFilter(bdd, channel_id, rank_range);
        await safeReply(interaction, "Filter successfully added ! ", true, true);
    } catch (e) {
        await sendLog(client, "Error while setting channel rank filter : " + e.message);
        await safeReply(interaction, "An error occurred while setting channel rank filter. Please try again !", true, true);
    }
}

module.exports = setChannelRankFilter;