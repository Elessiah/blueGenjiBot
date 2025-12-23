import type {Attachment, Client, Message, TextChannel} from "discord.js";
import {EmbedBuilder} from "discord.js";

import {getInviteFromMessage} from "../utils/getInviteFromMessage.js";

async function buildServiceMessage(client: Client,
                                   message: Message,
                                   channelId: string,
                                   attachement?: Attachment): Promise<EmbedBuilder> {
    const channelOG = await client.channels.fetch(channelId) as TextChannel;
    const origin: string = "*Sent from : [" + channelOG.guild.name + "](" + await getInviteFromMessage(client, message) + ")*";
    let embed: EmbedBuilder;
    if (attachement) {
        embed = new EmbedBuilder().setAuthor({
            name: `${message.author.username}`,
            iconURL: message.author.displayAvatarURL(),
        }).setDescription(message.content + "\n\n" + origin + ` by ${message.author}`).setImage(attachement.url);
    } else {
        embed = new EmbedBuilder().setAuthor({
            name: `${message.author.username}`,
            iconURL: message.author.displayAvatarURL(),
        }).setDescription(message.content + `\n\n` + origin + ` by ${message.author}`);
    }
    return embed;
}

export {buildServiceMessage};