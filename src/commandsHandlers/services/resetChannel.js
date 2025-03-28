const {getBddInstance} = require("../../bdd/Bdd");
const checkPermissions = require("../../check/checkPermissions");
const client = require("../../../main")
const sendLog = require("../../safe/sendLog");
const safeReply = require("../../safe/safeReply");

const _resetChannel = async(client, channel_id) => {
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Bdd failed in _resetChannel!");
        return {success: false, message: "Bdd failed !"};
    }
    let err_msg = "";
    let success = false;
    let nTry = 0;
    while (nTry < 10 && success === false) {
        try {
            const ret = await bdd.deleteChannelServices(channel_id);
            if (ret.success) {
                try {
                    let guild = await client.channels.fetch(channel_id);
                    guild = guild.guild;
                    const content = 'A service has been unlinked from a channel of ' + guild.name + '.';
                    await sendLog(client, content);
                    return {success: true, message: `Channel reseted`};
                } catch (error) {
                    nTry++;
                }
            } else {
                return {success: false, message: ret.message};
            }
        } catch (err) {
            err_msg = err.message;
            nTry++;
        }
    }
    if (nTry === 10) {
        return { success: false, message: err_msg + "\n Please contact elessiah" };
    }
}

const resetChannel = async(client, interaction) => {
    if (!await checkPermissions(interaction)) {
        return await safeReply(interaction, "You don't have the permission to do this.", true);
    }
    const channel_id = await interaction.options.getChannel("channel").id;
    let ret = await _resetChannel(client, channel_id);
    if (typeof ret === typeof undefined) {
        await sendLog(interaction.client, "resetChannel failed with no error message");
        return false;
    }
    if (ret.success === false) {
        if (ret.message !== "Channel has no services to delete.")
            await sendLog(interaction.client, "resetChannel failed : \n" + ret.message);
    }
    return await safeReply(interaction, ret.message);
}

module.exports = { resetChannel, _resetChannel };