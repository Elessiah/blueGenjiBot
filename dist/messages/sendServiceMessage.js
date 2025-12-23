import { sendLog } from "../safe/sendLog.js";
import { safeChannel } from "../safe/safeChannel.js";
async function sendServiceMessage(client, targets, message, embed, bdd, ranks) {
    let nbPartner = 0;
    for (const target of targets) {
        if (target.id_channel === message.channel.id || !(await bdd.partnerHasRanks(target.id_channel, ranks))) {
            continue;
        }
        const channel = await client.channels.fetch(target.id_channel);
        if (!channel) {
            await sendLog(client, `Failed to fetch channel ${target.id_channel} for sending service message`);
            return -1;
        }
        const sentMsg = await safeChannel(client, channel, embed);
        if (sentMsg) {
            const ret = await bdd.set("DPMsg", ['id_msg', 'id_channel', 'id_og'], [sentMsg.id, channel.id, message.id]);
            if (!ret.success) {
                await sendLog(client, "In manageDistribution : " + ret.message);
            }
            nbPartner++;
        }
    }
    return nbPartner;
}
export { sendServiceMessage };
//# sourceMappingURL=sendServiceMessage.js.map