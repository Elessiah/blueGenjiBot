import type {Client, Message, OmitPartialGroupDMChannel} from "discord.js";

import {describeError} from "@/safe/errorGuards.js";
import {safeMsgReply} from "@/safe/safeMsgReply.js";

/**
 * Supprime un message temporaire si celui-ci existe encore.
 * Utilisée en callback différé pour nettoyer les réponses éphémères "manuelles".
 *
 * L'échec est avalé volontairement : le callback s'exécute depuis un
 * `setTimeout`, hors de toute pile applicative, donc un rejet ici deviendrait
 * un `unhandledRejection` — c'est-à-dire un arrêt du process. Et le cas
 * nominal de cet échec est justement que le message a déjà été supprimé.
 *
 * @param target Message temporaire à supprimer, ou `null` si l'envoi a échoué.
 */
async function _deleteTempMsg(target: OmitPartialGroupDMChannel<Message> | null): Promise<void> {
    if (!target) return;
    try {
        await target.delete();
    } catch (error) {
        console.error("Suppression du message temporaire impossible :", describeError(error));
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
