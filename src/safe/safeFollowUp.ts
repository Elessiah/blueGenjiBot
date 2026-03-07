import { sendLog } from "./sendLog.js";
import {Attachment, ChatInputCommandInteraction, Message, MessageFlags} from "discord.js";

/**
 * Envoie un follow-up d'interaction en gérant les erreurs Discord.
 * @param interaction Interaction utilisateur en cours.
 * @param content Contenu texte du follow-up à envoyer.
 * @param is_ephemeral Si `true`, envoie la réponse en éphémère.
 * @param attachements Fichiers à joindre au message.
 * @returns Message Discord créé si l'envoi réussit, sinon `null` après 3 échecs.
 */
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
