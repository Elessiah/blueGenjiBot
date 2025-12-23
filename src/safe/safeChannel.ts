import { sendLog } from "./sendLog.js";
import type {Attachment, AttachmentBuilder, Client, Embed, EmbedBuilder, Message, TextChannel} from "discord.js";

async function safeChannel(client: Client,
                           channel: TextChannel,
                           embed?: Embed | EmbedBuilder,
                           attachements: Array<Attachment | AttachmentBuilder> = [],
                           content?: string) : Promise<Message | null> {
    if ((embed === null && content === "")) {
        await sendLog(client, "Wrong parameter for safeChannel : \nEmbed : " + embed);
        return null;
    }
    let nTry: number = 0;
    let err_msg: string = "";
    while (nTry < 3) {
        try {
            if (embed) {
                return await channel.send({content: content, embeds: [embed], files: attachements});
            } else {
                return await channel.send({content: content, files: attachements});
            }
        } catch (err) {
            err_msg = (err as TypeError).message;
        }
        nTry++;
    }
    await sendLog(client, "SafeMessage failed  to `" + channel.guild.name + "` : " + err_msg);
    return null;
}

export {safeChannel};