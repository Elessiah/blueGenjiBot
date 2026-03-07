import type {Client, Message, OmitPartialGroupDMChannel} from "discord.js";

import {safeMsgReply} from "@/safe/safeMsgReply.js";

/**
 * Supprime un message temporaire si celui-ci existe encore.
 * Utilisée en callback différé pour nettoyer les réponses éphémères "manuelles".
 * @param target Message temporaire à supprimer, ou `null` si l'envoi a échoué.
 */
async function _deleteTempMsg(target: OmitPartialGroupDMChannel<Message> | null): Promise<void> {
    if (target) {
        await target.delete();
    }
}

/**
 * Envoie une réponse temporaire à un message puis la supprime après un délai.
 * Le message est envoyé via `safeMsgReply`, puis supprime avec `setTimeout`.
 * @param client Client Discord utilisé pour l'envoi sécurisé de la réponse.
 * @param message Message source auquel répondre.
 * @param content Texte de la réponse temporaire.
 * @param time Délai avant suppression, en millisecondes.
 */
async function answerTmp(client: Client,
                         message: Message,
                         content: string,
                         time: number) : Promise<void> {
    const temp_msg = await safeMsgReply(client, message, content);
    /**
     * Callback différé chargé de supprimer le message temporaire.
     */
    setTimeout(() => {
        void _deleteTempMsg(temp_msg);
    }, time);
}

export {answerTmp};
