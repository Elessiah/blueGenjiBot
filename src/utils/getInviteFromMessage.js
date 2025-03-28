const {PermissionsBitField} = require("discord.js");
const getInviteFromChannel = require("./getInviteFromChannel");

async function getInviteFromMessage(client, message) {
    try {
        if (!message.channel.permissionsFor(message.author).has(PermissionsBitField.Flags.CreateInstantInvite))
            return ("");
        const channel = message.channel;
        if (channel == null)
            return ("");

        return await getInviteFromChannel(channel);
    } catch (e) {
        return "";
    }
}

module.exports = getInviteFromMessage;