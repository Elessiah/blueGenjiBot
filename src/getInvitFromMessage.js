const sendLog = require("./safe/sendLog");
const {PermissionsBitField} = require("discord.js");

async function getInvitFromMessage(client, message) {
    try {
        if (!message.channel.permissionsFor(message.author).has(PermissionsBitField.Flags.CreateInstantInvite))
            return ("");
        const channel = message.channel;
        if (channel == null)
            return ("");

        const invite = await channel.createInvite( {
            maxAge: 0,
            maxUses: 0,
            unique: false
        });
        return invite.url;
    } catch (e) {
        return "";
    }
}

module.exports = getInvitFromMessage;