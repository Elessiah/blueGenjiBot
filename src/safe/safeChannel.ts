import { sendLog } from "./sendLog.js";
import type {Attachment, AttachmentBuilder, Client, Embed, EmbedBuilder, Message, TextChannel} from "discord.js";

/**
 * Récupère un salon Discord de manière sûre avec gestion d'erreurs.
 * @param client Client Discord utilisé pour les appels API.
 * @param channel Salon cible.
 * @param embed Embed prêt à être envoyé (optionnel selon le contexte).
 * @param attachements Fichiers à joindre au message.
 * @param content Contenu texte à envoyer dans le salon (optionnel).
 * @returns Message envoyé si succès; `null` si l'envoi échoue après 3 tentatives ou paramètres invalides.
 */
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
