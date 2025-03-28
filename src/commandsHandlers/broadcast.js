const checkPermissions = require("../check/checkPermissions");
const safeReply = require("../safe/safeReply");
const {getBddInstance} = require("../bdd/Bdd");
const sendLog = require("../safe/sendLog");
const safeChannel = require("../safe/safeChannel");

async function broadcast(client, interaction) {
    if (await checkPermissions(interaction) === false) {
        await safeReply(interaction, "You don't have permission to broadcast !");
        return false;
    }
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Bdd failed in ban !");
        return false;
    }
    const targets = await bdd.get("ChannelPartner", ["id_channel"]);
    const msg = `# Developer Announcement Broadcast!\n> ${interaction.options.getString("message")}`;
    for (const target of targets) {
        try {
            const channel = await client.channels.fetch(target.id_channel);
            if (channel == null) {
                continue;
            }
            await safeChannel(client, channel, null, [], msg);
        } catch (e) {
            await sendLog(client, "Broadcast channel has failed one time : " + e.message);
        }
    }
    await safeReply(interaction, "Broadcast executed !");
}

module.exports = broadcast;