import {sendLog} from "../safe/sendLog.js";
import {answerTmp} from "../utils/answerTmp.js";
import {regions} from "../utils/globals.js";
import {nextTips} from "../utils/Tips.js";
import type {Client, Message} from "discord.js";
import type {Bdd} from "../bdd/Bdd.js";
import {status} from "../types.js";

/**
 * Gère la fin réussie d'un traitement de service (logs, feedback et nettoyages).
 * @param client Client Discord utilisé pour les appels API.
 * @param bdd Instance de base de données.
 * @param message Message d'origine qui vient d'être diffusé.
 * @param targetedRegions Indices des régions réellement ciblées pour la diffusion.
 * @param nbPartner Nombre de salons partenaires ayant reçu le message.
 * @param service Information de service à traiter.
 */
async function manageServiceSuccess(client: Client,
                                    bdd: Bdd,
                                    message: Message,
                                    targetedRegions: number[],
                                    nbPartner: number,
                                    service: string): Promise<void> {
    const ret: status = await bdd.set("OGMsg", ['id_msg', 'id_author'], [message.id, message.author.id]);
    if (!ret.success) {
        await sendLog(client, "In manageDistribution: " + ret.message);
    }
    await message.react("🛰️");
    let notifiedRegions: string[] = [];
    for (const region of targetedRegions)
        notifiedRegions.push(regions[region]);
    answerTmp(client, message, "Your message has been sent to " + nbPartner + " channels of " + notifiedRegions.join('/') + "/ALL region as " + service, 30000);
    for (const region of targetedRegions)
        await nextTips(client, service, region);
}

export {manageServiceSuccess};
