import { sendLog } from "./sendLog.js";
import type {Attachment, Client, Embed, User, Message, AttachmentBuilder} from "discord.js";

async function safeUser(client: Client,
                        user: User,
                        embed?: Embed,
                        attachements: Array<AttachmentBuilder> = [],
                        content: string =""): Promise<Message | null> {
    if ((embed === null && content === "") || user === null || user === undefined) {
        await sendLog(client, "Wrong parameter for safeChannel : \nUser : " + user + "\nEmbed : " + embed);
    }
    let nTry = 0;
    let err_msg = "";
    while (nTry < 3) {
        try {
            if (embed) {
                return await user.send({content: content, embeds: [embed], files: attachements});
            } else {
                return await user.send({content: content, files: attachements});
            }
        } catch (err) {
            err_msg = (err as TypeError).message;
        }
        nTry++;
    }
    await sendLog(client, "SafeUser failed : " + err_msg);
    return null;
}

export {safeUser};