const {getBddInstance} = require("../../bdd/Bdd");
const checkPermissions = require("../../check/checkPermissions");
const sendLog = require("../../safe/sendLog");
const safeReply = require("../../safe/safeReply");

const _resetServer = async(client, guild_id) => {
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Bdd failed in ResetServer!");
        return;
    }
    try {
        const channels_id = await bdd.get("channelPartner", ["id_channel"], {}, {id_guild: guild_id});
        if (channels_id.length === 0)
            return ( {success: false, message: "Server already reseted"} );
        let message = "";
        let success = true;
        for (const channel_id of channels_id) {
            const ret = await bdd.deleteChannelServices(channel_id.id_channel);
            if (ret.success === false) {
                success = false;
                message += ret.message + "\n";
            }
        }
        if (success === true) {
            try {
                const guild = await client.guilds.fetch(guild_id);
                await sendLog(client, `Server "${guild.name}" has deleted all services.`);
                return {success: true, message: "Server reseted."};
            } catch (error) {
                console.log(error);
                return {success: false, message: error.message};
            }
        } else {
            return {success: false, message: message};
        }
    } catch (err) {
        console.log(err);
        await sendLog(client, "_resetServer failed : \n" + err);
        return {success: false, message: "An error occurred while trying to reset server : " + err.message};
    }
}

const resetServer = async(client, interaction) => {
    if (!await checkPermissions(interaction)) {
        return await safeReply(interaction, "You don't have the permission to do this.", true);
    }
    await interaction.deferReply({ephemeral: true});
    const ret = await _resetServer(client, interaction.guildId);
    if (ret.success) {
        await safeReply(interaction,`Server "${interaction.guild.name}" reseted`, true, true);
    } else {
        if (ret.message !== "Server already reseted") {
            await sendLog(interaction.client, "ResetServer has failed :\n" + ret.message);
            await safeReply(interaction, "Reset has failed. Please try again.", true, true);
        } else {
            await safeReply(interaction, ret.message, true, true);
        }

    }
}

module.exports = {resetServer, _resetServer};