import type {Client, Message, TextChannel} from "discord.js";
import {PermissionsBitField} from "discord.js";
import {getInviteFromChannel} from "./getInviteFromChannel.js";

async function getInviteFromMessage(client: Client,
                                    message: Message) {
    try {
        if (message.channel.isTextBased())
            return ("");
        const channel: TextChannel = message.channel as TextChannel;
        if (!channel)
            return ("");
        const permissions = channel.permissionsFor(message.author);
        if (!permissions)
            return "";
        if (permissions.has(PermissionsBitField.Flags.CreateInstantInvite))
            return ("");
        return await getInviteFromChannel(channel);
    } catch (e) {
        return "";
    }
}

export { getInviteFromMessage }