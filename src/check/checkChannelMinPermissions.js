import sendLog from "../safe/sendLog";

async function checkChannelMinPermissions(client, channel) {
    const permissions = channel.permissionsFor(channel.guild.members.me);

    if (!permissions) {
        await sendLog(client, "An error occured while retrieving permissions of a channel !");
        return false;
    }
    const canRead = permissions.has('ViewChannel');
    if (!canRead) {
        return "Missing right to read the channel";
    }
    const canSend = permissions.has('SendMessages');
    if (!canSend) {
        return "Missing right to send messages to the channel";
    }
    return true;
}

module.exports = checkChannelMinPermissions;