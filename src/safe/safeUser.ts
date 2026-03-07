import { sendLog } from "./sendLog.js";
import type {Client, Embed, User, Message, AttachmentBuilder} from "discord.js";

/**
 * Récupère un utilisateur Discord avec gestion d'erreurs.
 * @param client Client Discord utilisé pour les appels API.
 * @param user Utilisateur concerne.
 * @param embed Embed prêt à être envoyé (optionnel selon le contexte).
 * @param attachements Fichiers à joindre au message.
 * @param content Contenu texte du message privé à envoyer.
 * @returns Message privé envoyé si succès; `null` en cas d'échec après 3 tentatives.
 */
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
