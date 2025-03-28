const sendLog = require("../../safe/sendLog");
const {getBddInstance} = require("../../bdd/Bdd");
const safeReply = require("../../safe/safeReply");
const {regions} = require("../../utils/enums");

async function displayChannelFilter(client, interaction) {
    try {
        const bdd = await getBddInstance();
        if (!bdd) {
            await sendLog(client, "Bdd failed in ban !");
            return false;
        }
        const channel_id = interaction.options.getChannel("channel").id;
        let region = await bdd.get("ChannelPartner", ["region"], {}, {id_channel: channel_id});
        if (region.length === 0) {
            await safeReply(interaction, "This channel is not connected to any service.");
        } else {
            region = region[0].region;
            await safeReply(interaction, `The filter of this channel is : **${regions[region]}**.`);
        }
    } catch (e) {
        await safeReply(interaction, "An error occurred while trying to display channel filter.");
        await sendLog(client, "Error while displaying channel filter : " + e.message);
    }
}

module.exports = displayChannelFilter;