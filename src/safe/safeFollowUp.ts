import { sendLog } from "./sendLog.js";
import type {Attachment, ChatInputCommandInteraction, Message} from "discord.js";

async function safeFollowUp(interaction: ChatInputCommandInteraction,
                            content: string = "Empty FollowUp",
                            is_ephemeral: boolean = true,
                            attachements: Array<Attachment>) : Promise<Message | null> {
    let nTry: number = 0;
    let err_msg: string = "";
    while (nTry < 3) {
        try {
            return await interaction.followUp({content: content, ephemeral: is_ephemeral, files: attachements});
        } catch (err) {
            err_msg = (err as TypeError).message;
            nTry++;
        }
    }
    await sendLog(interaction.client, "safeFollowUp failed : " + err_msg);
    return null;
}

export {safeFollowUp};