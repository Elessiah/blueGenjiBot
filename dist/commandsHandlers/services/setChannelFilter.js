import { MessageFlags } from "discord.js";
import { getBddInstance } from "../../bdd/Bdd.js";
import { sendLog } from "../../safe/sendLog.js";
import { checkPermissions } from "../../check/checkPermissions.js";
import { safeReply } from "../../safe/safeReply.js";
async function setChannelFilter(client, interaction) {
    try {
        if (!await checkPermissions(interaction)) {
            await safeReply(interaction, "You don't have the permission to edit channel filter.");
            return true;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const bdd = await getBddInstance();
        const channel = interaction.options.getChannel("channel");
        if (!channel) {
            await safeReply(interaction, "Missing channel in command parameters.");
            return true;
        }
        const channel_id = channel.id;
        const region = interaction.options.getInteger("region");
        if (!region) {
            await safeReply(interaction, "Missing region in command parameters.");
            return false;
        }
        const current_filter = await bdd.get("ChannelPartner", ["region"], {}, { query: "id_channel = ?", values: [channel_id] });
        if (current_filter == null || current_filter.length === 0) {
            await safeReply(interaction, "This channel is not link to any service", true, true);
            return true;
        }
        if (current_filter[0].region === region) {
            await safeReply(interaction, "This filter is already active !", true, true);
            return true;
        }
        await bdd.update("ChannelPartner", { region: region }, { id_channel: channel_id });
        await safeReply(interaction, "The channel filter has been updated!", true, true);
        return true;
    }
    catch (e) {
        await safeReply(interaction, "An error occurred while trying to edit channel filter. Please try again or contact : elessiah. Error : " + e.message, true, true);
        await sendLog(client, "Error while trying to edit channel filter : " + e.message);
        return false;
    }
}
export { setChannelFilter };
//# sourceMappingURL=setChannelFilter.js.map