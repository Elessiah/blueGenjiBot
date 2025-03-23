const checkPermissions = require("./checkPermissions");
const safeReply = require("./safe/safeReply");
const {getBddInstance} = require("./Bdd");
const sendLog = require("./safe/sendLog");
const {_resetServer} = require("./resetServer");

async function remoteServerReset(client, interaction) {
    if (await checkPermissions(interaction) === false) {
        await safeReply(interaction, "You don't have permission to ban users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n");
        return false;
    }
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Bdd failed in ban !");
        return false;
    }
    const serverId = interaction.options.getString("server");
    const result = await _resetServer(client, serverId);
    await safeReply(interaction, result.message);
    return result.success;
}

module.exports = remoteServerReset;