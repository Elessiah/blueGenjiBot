import type {Client, Message} from "discord.js";

import type {Service} from "../bdd/types.js";
import {checkBan} from "../check/checkBan.js";
import {checkCooldown} from "../check/checkCooldown.js";
import {answerTmp} from "../utils/answerTmp.js";
import {searchString} from "../utils/searchString.js";

/**
 * Vérifie qu'un message de service contient les données minimales avant distribution.
 * @param client Client Discord utilisé pour les appels API.
 * @param service Information de service à traiter.
 * @param messageContentLower Contenu du message en minuscules, utilisé pour détecter les mots-clés.
 * @param message Message Discord source à valider.
 * @param hasValidService Référence mutable marquée à `true` dès qu'un service valide est détecté.
 * @returns `true` si le message cible ce service, que l'auteur n'est pas banni et que le cooldown est expiré; sinon `false`.
 */
async function checkMessageValidity(client: Client,
                                    service: Service,
                                    messageContentLower: string,
                                    message: Message,
                                    hasValidService: {value: boolean}): Promise<boolean> {
    if (!await searchString(service.name, messageContentLower)) {
        return false;
    } else {
        hasValidService.value = true;
    }
    if (await checkBan(client, message.author.id)) {
        await message.react("🚫");
        return false;
    }
    const cooldown: string = await checkCooldown(message.author.id, service.id_service);
    if (cooldown.length > 0) {
        void answerTmp(client, message, `You must wait ${cooldown} minutes before sending again a message on this service`, 30000);
        return false;
    }
    return true;
}

export {checkMessageValidity};
