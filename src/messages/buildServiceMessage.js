const getInviteFromMessage = require("../utils/getInviteFromMessage");
const {EmbedBuilder} = require("discord.js");

async function buildServiceMessage(client, message, channelId, attachement) {
    const channelOG = await client.channels.fetch(channelId);
    const origin = "*Sent from : [" + channelOG.guild.name + "](" + await getInviteFromMessage(client, message) + ")*";
    let embed;
    if (attachement.length > 0) {
        embed = new EmbedBuilder().setAuthor({
            name: `${message.author.username}`,
            iconURL: message.author.displayAvatarURL(),
        }).setDescription(message.content + "\n\n" + origin + ` by ${message.author}`).setImage(attachement);
    } else {
        embed = new EmbedBuilder().setAuthor({
            name: `${message.author.username}`,
            iconURL: message.author.displayAvatarURL(),
        }).setDescription(message.content + `\n\n` + origin + ` by ${message.author}`);
    }
    return embed;
}

module.exports = buildServiceMessage;