import { MessageFlags } from "discord.js";
import { getBddInstance } from "../../bdd/Bdd.js";
import { checkPermissions } from "../../check/checkPermissions.js";
import { sendLog } from "../../safe/sendLog.js";
import { safeReply } from "../../safe/safeReply.js";
async function _resetServer(client, guild_id) {
    const bdd = await getBddInstance();
    try {
        const channels_id = await bdd.get("channelPartner", ["id_channel"], {}, { query: "id_guild = ?", values: [guild_id] });
        if (channels_id.length === 0)
            return ({ success: false, message: "Server already reseted" });
        let message = "";
        let success = true;
        for (const channel_id of channels_id) {
            await bdd.rm("ChannelPartnerRank", {}, { query: "id_channel = ?", values: [channel_id] });
            const ret = await bdd.deleteChannelServices(channel_id.id_channel);
            if (!ret.success) {
                success = false;
                message += ret.message + "\n";
            }
        }
        if (success) {
            try {
                const guild = await client.guilds.fetch(guild_id);
                await sendLog(client, `Server "${guild.name}" has deleted all services.`);
                return { success: true, message: "Server reseted." };
            }
            catch (error) {
                await sendLog(client, "Erreur lors de la récupération de la guild !" + error.message);
                return { success: false, message: error.message };
            }
        }
        else {
            return { success: false, message: message };
        }
    }
    catch (err) {
        console.error(err);
        await sendLog(client, "_resetServer failed : \n" + err);
        return { success: false, message: "An error occurred while trying to reset server : " + err.message };
    }
}
async function resetServer(client, interaction) {
    if (!await checkPermissions(interaction)) {
        return await safeReply(interaction, "You don't have the permission to do this.", true);
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!interaction.guildId) {
        return await safeReply(interaction, "Error. The guildID was not found on the interaction, please try again on a discord server !");
    }
    const ret = await _resetServer(client, interaction.guildId);
    if (ret.success) {
        if (interaction.guild)
            await safeReply(interaction, `Server "${interaction.guild.name}" reseted`, true, true);
        else
            await safeReply(interaction, "Server reseted", true, true);
        return true;
    }
    else {
        if (ret.message !== "Server already reseted") {
            await sendLog(interaction.client, "ResetServer has failed :\n" + ret.message);
            await safeReply(interaction, "Reset has failed. Please try again.", true, true);
            return true;
        }
        else {
            await safeReply(interaction, ret.message, true, true);
            return true;
        }
    }
}
export { resetServer, _resetServer };
//# sourceMappingURL=resetServer.js.map