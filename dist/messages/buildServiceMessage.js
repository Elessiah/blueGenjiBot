import { EmbedBuilder } from "discord.js";
import { getInviteFromMessage } from "../utils/getInviteFromMessage.js";
async function buildServiceMessage(client, message, channelId, attachement) {
    const channelOG = await client.channels.fetch(channelId);
    const origin = "*Sent from : [" + channelOG.guild.name + "](" + await getInviteFromMessage(client, message) + ")*";
    let embed;
    if (attachement) {
        embed = new EmbedBuilder().setAuthor({
            name: `${message.author.username}`,
            iconURL: message.author.displayAvatarURL(),
        }).setDescription(message.content + "\n\n" + origin + ` by ${message.author}`).setImage(attachement.url);
    }
    else {
        embed = new EmbedBuilder().setAuthor({
            name: `${message.author.username}`,
            iconURL: message.author.displayAvatarURL(),
        }).setDescription(message.content + `\n\n` + origin + ` by ${message.author}`);
    }
    return embed;
}
export { buildServiceMessage };
//# sourceMappingURL=buildServiceMessage.js.map