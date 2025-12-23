import { getBddInstance } from "../bdd/Bdd.js";
import { checkPermissions } from "../check/checkPermissions.js";
import { safeChannel } from "../safe/safeChannel.js";
import { safeReply } from "../safe/safeReply.js";
import { sendLog } from "../safe/sendLog.js";
async function broadcast(client, interaction) {
    if (!await checkPermissions(interaction)) {
        await safeReply(interaction, "You don't have permission to broadcast !");
        return false;
    }
    const bdd = await getBddInstance();
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const targets = await bdd.get("ChannelPartner", ["id_channel"]);
    const msg = `# Developer Announcement Broadcast!\n> ${interaction.options.getString("message")}`;
    for (const target of targets) {
        try {
            const channel = await client.channels.fetch(target.id_channel);
            if (channel == null) {
                continue;
            }
            await safeChannel(client, channel, undefined, [], msg);
        }
        catch (e) {
            await sendLog(client, "Broadcast channel has failed one time : " + e.message);
        }
    }
    await safeReply(interaction, "Broadcast executed !", true, true);
    return true;
}
export { broadcast };
//# sourceMappingURL=broadcast.js.map