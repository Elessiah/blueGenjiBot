import type {Client, Message, OmitPartialGroupDMChannel} from "discord.js";

import {sendLog} from "@/safe/sendLog.js";

/**
 * Répond à un message avec garde-fous pour éviter les erreurs bloquantes.
 * @param client Client Discord utilisé pour les appels API.
 * @param msg Message Discord auquel répondre.
 * @param content Contenu texte de la réponse.
 * @returns Message de réponse créé si succès, sinon `null` après retries.
 */
async function safeMsgReply(client: Client,
                            msg: Message,
                            content: string) : Promise<OmitPartialGroupDMChannel<Message> | null>  {
    let nTry = 0;
    let err_msg = "";
    while (nTry < 3) {
        try {
            return await msg.reply(content);
        } catch (err) {
            err_msg = (err as TypeError).message;
            nTry += 1;
        }
    }
    await sendLog(client, "Error safeMsgReply : " + err_msg);
    return null;
}

export {safeMsgReply};
