const sendLog = require("../../safe/sendLog");
const safeReply = require("../../safe/safeReply");
const {getBddInstance} = require("../../bdd/Bdd");
const formatRawRanks = require("../../utils/formatRawRanks");

async function displayChannelRankFilter(client, interaction) {
    try {
        await interaction.deferReply({ephemeral: true});
        const channel_id = interaction.options.getChannel("channel").id;
        const bdd = await getBddInstance();
        if (!bdd) {
            await sendLog(client, "Bdd failed in ban !");
            return false;
        }
        const result_request = await bdd.get(
            "Ranks",
            ["name"],
            {"ChannelPartnerRank": "ChannelPartnerRank.id_rank = Ranks.id_rank"},
            {"ChannelPartnerRank.id_channel": channel_id}
        );
        if (!result_request || result_request.length === 0) {
            await safeReply(interaction, "This channel is not connected to any services ! ", true, true);
        } else {
            let covered_ranks = result_request.map(obj => Object.values(obj)).flat();
            covered_ranks = await formatRawRanks(covered_ranks);
            await safeReply(interaction, "This channel will receive ads concerning these ranks :\n" + covered_ranks, true, true);
        }
        return true;
    } catch (e) {
        await sendLog(client, "Error while displaying channel rank filter : " + e);
        await safeReply(interaction, "An error occurred, please try again", true, true);
        return false;
    }
}

module.exports = displayChannelRankFilter;