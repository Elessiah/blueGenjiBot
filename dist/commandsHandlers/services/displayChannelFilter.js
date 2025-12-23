import { sendLog } from "../../safe/sendLog.js";
import { getBddInstance } from "../../bdd/Bdd.js";
import { safeReply } from "../../safe/safeReply.js";
import { regions } from "../../utils/globals.js";
async function displayChannelFilter(client, interaction) {
    try {
        const bdd = await getBddInstance();
        const channel = interaction.options.getChannel("channel");
        if (!channel) {
            await safeReply(interaction, "Channel not found in the options!");
            return;
        }
        const channel_id = channel.id;
        let region = await bdd.get("ChannelPartner", ["region"], {}, { query: "id_channel = ?", values: [channel_id] });
        if (region.length === 0) {
            await safeReply(interaction, "This channel is not connected to any service.");
        }
        else {
            const id_region = region[0].region;
            await safeReply(interaction, `The filter of this channel is : **${regions[id_region]}**.`);
        }
    }
    catch (e) {
        await safeReply(interaction, "An error occurred while trying to display channel filter.");
        await sendLog(client, "Error while displaying channel filter : " + e.message);
    }
}
export { displayChannelFilter };
//# sourceMappingURL=displayChannelFilter.js.map