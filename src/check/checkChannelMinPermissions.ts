import type {Client, GuildMember, PermissionsBitField, TextChannel} from "discord.js";

import { sendLog } from "../safe/sendLog.js";

/**
 *
 * @param client
 * @param channel
 * @return string Retourne un message d'erreur. Si rien, pas d'erreur.
 */
async function checkChannelMinPermissions(client: Client,
                                          channel: TextChannel): Promise<string> {
    const me: GuildMember | null = channel.guild.members.me;
    if (!me) {
        await sendLog(client, "An error occured while trying to retrieve bot object for permissions !");
        return "An error occured, while trying to retrieve bot object for permissions !";
    }
    const permissions: Readonly<PermissionsBitField> = channel.permissionsFor(me);

    if (!permissions) {
        await sendLog(client, "An error occured while retrieving permissions of a channel !");
        return "An error occured while retrieving permissions of a channel !";
    }
    const canRead = permissions.has('ViewChannel');
    if (!canRead) {
        return "Missing right to read the channel";
    }
    const canSend = permissions.has('SendMessages');
    if (!canSend) {
        return "Missing right to send messages to the channel";
    }
    return "";
}

export {checkChannelMinPermissions};
