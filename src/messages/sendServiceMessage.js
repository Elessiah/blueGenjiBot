const safeChannel = require("../safe/safeChannel");
const sendLog = require("../safe/sendLog");

async function sendServiceMessage(client, targets, message, embed, bdd, ranks) {
    let nbPartner = 0;
    for (const target of targets) {
        if (target.id_channel === message.channel.id || !(await bdd.partnerHasRanks(target.id_channel, ranks))) {
            continue;
        }
        const channel = await client.channels.fetch(target.id_channel);
        const sentMsg = await safeChannel(client, channel, embed);
        if (sentMsg !== false) {
            const ret = await bdd.set("DPMsg",
                ['id_msg', 'id_channel', 'id_og'],
                [sentMsg.id, channel.id, message.id]);
            if (ret.success === false) {
                await sendLog(client, "In manageDistribution : " + ret.message);
            }
            nbPartner++;
        }
    }
    return nbPartner;
}

module.exports = sendServiceMessage;