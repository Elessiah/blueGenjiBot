import { PermissionsBitField } from "discord.js";
import { getInviteFromChannel } from "./getInviteFromChannel.js";
async function getInviteFromMessage(client, message) {
    try {
        if (message.channel.isTextBased())
            return ("");
        const channel = message.channel;
        if (!channel)
            return ("");
        const permissions = channel.permissionsFor(message.author);
        if (!permissions)
            return "";
        if (permissions.has(PermissionsBitField.Flags.CreateInstantInvite))
            return ("");
        return await getInviteFromChannel(channel);
    }
    catch (e) {
        return "";
    }
}
export { getInviteFromMessage };
//# sourceMappingURL=getInviteFromMessage.js.map