const {getBddInstance} = require("./Bdd");
const checkPermissions = require("./checkPermissions");
const client = require("../main");
const sendLog = require("./safe/sendLog");
const safeReply = require("./safe/safeReply");

const _resetServer = async(guild_id) => {
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog("Bdd failed in ResetServer!");
        return;
    }
    let err_msg = "";
    let nTry = 0;
    while (nTry < 10) {
        try {
            const channels_id = await bdd.get("channelPartner", ["id_channel"], {}, {id_guild: guild_id});
            let message = "";
            let success = true;
            for (const channel_id of channels_id) {
                const ret = await bdd.deleteChannelServices(channel_id.id_channel);
                if (!ret.success) {
                    success = false;
                    message += ret.message + "\n";
                }
            }
            if (success) {
                try {
                    const guild = await client.guilds.fetch(guild_id);
                    await sendLog(`Server "${guild.name}" has deleted all services.`);
                    return {success: true, message: "Server reseted."};
                }
                catch (error) {
                    console.log(error);
                }
            } else {
                return {success: false, message: message};
            }
        } catch (err) {
            console.log(err);
            err_msg = err.message;
        }
        nTry++;
    }
    return {success: false, message: err_msg};
}

const resetServer = async(interaction) => {
    if (!await checkPermissions(interaction)) {
        return await safeReply(interaction, "You don't have the permission to do this.", true);
    }
    const ret = await _resetServer(interaction.guildId);
    if (ret.success) {
        await interaction.reply({content: `Server "${interaction.guild.name}" reseted`, ephemeral: true})
    } else {
        await sendLog("ResetServer has failed :\n" + ret.message);
        await safeReply(interaction, "Reset has failed. Please try again.", true);
    }
}

module.exports = {resetServer, _resetServer};