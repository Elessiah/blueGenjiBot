import {ChatInputCommandInteraction, MessageFlags} from "discord.js";
import {sendLog} from "./sendLog.js";

/**
 * Répond à une interaction avec gestion centralisée des erreurs.
 * @param interaction Interaction utilisateur en cours.
 * @param content Contenu texte à envoyer ou à utiliser pour l'édition.
 * @param is_ephemeral Si `true`, envoie la réponse en éphémère.
 * @param lateReply Si `true`, édite la réponse différée au lieu d'envoyer un nouveau message.
 * @returns `true` si la réponse/édition réussit en 3 tentatives max; sinon `false` après journalisation.
 */
async function safeReply(interaction: ChatInputCommandInteraction,
                         content: string = "Empty Reply",
                         is_ephemeral: boolean = true,
                         lateReply: boolean = false) : Promise<boolean> {
    let nTry = 0;
    let success = false;
    let err_msg = "";
    while (nTry < 3 && !success) {
        try {
            if (!lateReply) {
                if (is_ephemeral) {
                    await interaction.reply({content: content, flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({content: content});
                }
            }
            else
                await interaction.editReply({content: content });
            success = true;
        } catch (err) {
            err_msg = (err as TypeError).message;
            nTry++;
        }
    }
    if (!success) {
        await sendLog(interaction.client, "safeReply failed : " + err_msg);
        return false;
    }
    return true;
}

export {safeReply};
