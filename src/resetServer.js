const {getBddInstance} = require("./Bdd");
const checkPermissions = require("./checkPermissions");

const _resetServer = async(guild_id) => {
    const bdd = await getBddInstance();
    if (!bdd) {
        console.log("Bdd failed !");
        return;
    }
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
            return { success: true, message: "Server reseted." };
        } else {
            return { success: false, message: message };
        }
    } catch (err) {
        console.log(err);
        return { success: false, message: "No service found on this server !" };
    }
}

const resetServer = async(interaction) => {
    if (!await checkPermissions(interaction)) {
        await interaction.reply({ content: "You don't have the permission to do this.", ephemeral: true });
        return;
    }
    const ret = await _resetServer(interaction.guildId);
    if (ret.success) {
        await interaction.reply({content: `Server "${interaction.guild.name}" reseted`, ephemeral: true})
    } else {
        await interaction.reply({content: ret.message, ephemeral: true})
    }
}

module.exports = {resetServer, _resetServer};