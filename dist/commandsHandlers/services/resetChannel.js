import { getBddInstance } from "../../bdd/Bdd.js";
import { checkPermissions } from "../../check/checkPermissions.js";
import { sendLog } from "../../safe/sendLog.js";
import { safeReply } from "../../safe/safeReply.js";
import { MessageFlags } from "discord.js";
async function _resetChannel(client, channel_id) {
    const bdd = await getBddInstance();
    let err_msg = "";
    let success = false;
    let nTry = 0;
    while (nTry < 10 && !success) {
        try {
            await bdd.rm("ChannelPartnerRank", {}, { query: "id_channel = ?", values: [channel_id] });
            const ret = await bdd.deleteChannelServices(channel_id);
            if (ret.success) {
                let channel = await client.channels.fetch(channel_id);
                if (!channel) {
                    await sendLog(client, "Failed to retrieve the targeted channel to reset");
                    return { success: false, message: "Failed, retrieving targeted channel to reset!" };
                }
                const guild = channel.guild;
                const content = 'A service has been unlinked from a channel of ' + guild.name + '.';
                await sendLog(client, content);
                return { success: true, message: `Channel reseted` };
            }
            else {
                return { success: false, message: ret.message };
            }
        }
        catch (err) {
            err_msg = err.message;
            nTry++;
        }
    }
    if (nTry === 10) {
        return { success: false, message: err_msg + "\n Please contact elessiah" };
    }
    return { success: true, message: "" };
}
async function resetChannel(client, interaction) {
    if (!await checkPermissions(interaction)) {
        return await safeReply(interaction, "You don't have the permission to do this.", true);
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.options.getChannel("channel");
    if (!channel) {
        await safeReply(interaction, "Missing target channel !", true, true);
        return false;
    }
    const channel_id = channel.id;
    let ret = await _resetChannel(client, channel_id);
    if (!ret.success) {
        if (ret.message !== "Channel has no services to delete.")
            await sendLog(interaction.client, "resetChannel failed : \n" + ret.message);
    }
    return await safeReply(interaction, ret.message, true, true);
}
export { resetChannel, _resetChannel };
//# sourceMappingURL=resetChannel.js.map