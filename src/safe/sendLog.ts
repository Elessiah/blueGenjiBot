import type {Client, TextChannel, User} from "discord.js";
import {idSendLogMsg} from "./types.js";
import {describeError, errorCode} from "./errorGuards.js";

/** Essais d'un envoi au journal : seule la lecture du titulaire et sa copie privée sont rejouées. */
const MAX_ATTEMPTS = 3;

/** Code Discord d'un accès refusé au salon de supervision. */
const MISSING_ACCESS = 50001;

/**
 * Envoie un log technique vers le canal de supervision.
 * @param client Client Discord utilisé pour les appels API.
 * @param message Contenu du log à envoyer aux canaux owner/admin.
 * @param idMsg Objet optionnel recevant les IDs des messages de log envoyés (owner/admin).
 * @param copyToOwner Envoyer aussi le message en privé au titulaire (`OWNER_ID`) ; par défaut, seulement quand `idMsg` est fourni (comportement d'origine).
 * @returns `true` dès qu'un envoi de log aboutit; `false` si les tentatives échouent ou si le canal admin est inaccessible.
 */
async function sendLog(client: Client,
                       message: string = "Error",
                       idMsg?: idSendLogMsg,
                       copyToOwner: boolean = idMsg !== undefined) : Promise<boolean> {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
            const owner: User = await client.users.fetch(process.env.OWNER_ID as string);
            if (copyToOwner) {
                const sent = await owner.send(message);
                if (idMsg) {
                    idMsg.owner = sent.id;
                }
            }
            return await postToAdminChannel(client, owner, message, idMsg);
        } catch (error) {
            // `describeError` ne lève pas : une valeur rejetée étrange (null…) ne
            // fait pas lever `sendLog`, dont les appelants comptent qu'il ne lève jamais.
            console.error("Erreur while sending to the owner : ", describeError(error));
        }
    }
    return false;
}

/**
 * Publie le message dans le salon de supervision (`INFO_SERV`).
 *
 * Ne lève jamais : un échec de lecture ou d'envoi est sans issue ici — on est
 * déjà dans la voie de secours — et compte comme un envoi fait. Seul l'accès
 * refusé est signalé au titulaire.
 * @param client Client Discord utilisé pour les appels API.
 * @param owner Titulaire, prévenu d'un accès refusé.
 * @param message Contenu du log.
 * @param idMsg Reçoit l'identifiant du message publié, s'il est fourni.
 * @returns `false` si le salon n'existe pas, `true` sinon.
 */
async function postToAdminChannel(client: Client, owner: User, message: string, idMsg?: idSendLogMsg): Promise<boolean> {
    try {
        const admin_channel: TextChannel | null = await client.channels.fetch(process.env.INFO_SERV as string) as TextChannel;
        if (!admin_channel)
            return false;
        const sent = await admin_channel.send(message);
        if (idMsg) {
            idMsg.admin = sent.id;
        }
    } catch (error) {
        // `await` obligatoire : un envoi flottant qui échoue devient un
        // rejet non capturé, donc un arrêt du process.
        if (errorCode(error) === MISSING_ACCESS) {
            try {
                await owner.send("Missing Access to admin channel");
            } catch { /* le canal de secours est lui aussi injoignable */ }
        }
    }
    return true;
}

export { sendLog };
