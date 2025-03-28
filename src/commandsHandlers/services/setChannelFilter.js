const {getBddInstance} = require("../../bdd/Bdd");
const sendLog = require("../../safe/sendLog");
const checkPermissions = require("../../check/checkPermissions")
const safeReply = require("../../safe/safeReply");

async function setChannelFilter(client, interaction) {
    try {
        if (await checkPermissions(interaction) === false) {
            await safeReply(interaction, "You don't have the permission to edit channel filter.");
            return true;
        }
        const bdd = await getBddInstance();
        if (!bdd) {
            await sendLog(client, "Bdd failed in ban !");
            return false;
        }
        const channel_id = interaction.options.getChannel("channel").id;
        const region = interaction.options.getInteger("region");
        const current_filter = await bdd.get("ChannelPartner", ["region"], {}, {id_channel: channel_id});
        if (current_filter == null || current_filter.length === 0) {
            await safeReply(interaction, "This channel is not link to any service");
            return true;
        }
        if (current_filter[0].region === region) {
            await safeReply(interaction, "This filter is already active !");
            return true;
        }
        await bdd.update("ChannelPartner", {region: region}, {id_channel: channel_id});
        await safeReply(interaction, "The channel filter has been updated!");
        return true;
    } catch (e) {
        await safeReply("An error occurred while trying to edit channel filter. Please try again or contact : elessiah");
        await sendLog(client, "Error while trying to edit channel filter : " + e.message);
        return false;
    }
}

module.exports = setChannelFilter;