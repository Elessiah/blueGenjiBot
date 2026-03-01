import { sendLog } from "./sendLog.js";
import {Attachment, ChatInputCommandInteraction, Message, MessageFlags} from "discord.js";

async function safeFollowUp(interaction: ChatInputCommandInteraction,
                            content: string = "Empty FollowUp",
                            is_ephemeral: boolean = true,
                            attachements: Array<Attachment>) : Promise<Message | null> {
    let nTry: number = 0;
    let err_msg: string = "";
    while (nTry < 3) {
        try {
            if (is_ephemeral) {
                return await interaction.followUp({content: content, flags: MessageFlags.Ephemeral, files: attachements});
            } else {
                return await interaction.followUp({content: content, files: attachements});
            }
        } catch (err) {
            err_msg = (err as TypeError).message;
            nTry++;
        }
    }
    await sendLog(interaction.client, "safeFollowUp failed : " + err_msg);
    return null;
}

export {safeFollowUp};