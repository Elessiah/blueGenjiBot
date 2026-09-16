import type {Client, Message} from "discord.js";

import type {Service} from "../bdd/types.js";
import {checkBan} from "../check/checkBan.js";
import {checkCooldown} from "../check/checkCooldown.js";
import {safeReact} from "../safe/safeReact.js";
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
    const banVerdict = await checkBan(client, message.author.id);
    if (banVerdict === "BANNED") {
        await safeReact(client, message, "🚫");
        return false;
    }
    // Verdict indisponible : on ne distribue pas. Un message relaye ne se
    // rattrape pas, et le cooldown qui suit lit la meme base -- il echouerait.
    // Reaction distincte du 🚫 : on ne vient d'accuser personne.
    if (banVerdict === "UNKNOWN") {
        await safeReact(client, message, "⚠️");
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
