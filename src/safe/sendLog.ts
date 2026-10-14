import type {Client, TextChannel, User} from "discord.js";
import {idSendLogMsg} from "./types.js";
import {describeError, discordJsonCode, errorCode} from "./errorGuards.js";

/** Essais d'un envoi au journal : seule la lecture du titulaire et sa copie privée sont rejouées. */
const MAX_ATTEMPTS = 3;

/** Code Discord d'un accès refusé au salon de supervision. */
const MISSING_ACCESS = 50001;

/** Code Discord d'une ressource d'API surchargée : passager. */
const API_OVERLOADED = 130_000;

/** Délai entre deux avis « Missing Access » au titulaire venus de {@link sendLogConfirmed}. */
const OWNER_NOTICE_COOLDOWN_MS = 60 * 60 * 1000;

let lastOwnerNoticeAt = Number.NEGATIVE_INFINITY;

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

/**
 * Publie un signalement dans le salon de supervision (`INFO_SERV`), sans copie
 * au titulaire, et rend `false` seulement si **rien n'a pu partir** pour une
 * cause passagère — salon illisible (réseau, `5xx`), API surchargée : un
 * nouvel essai peut réussir. Pour l'appelant qui n'étrangle ses signalements
 * qu'une fois l'un d'eux traité ; {@link sendLog}, lui, compte tout échec fait.
 * Compte comme traité : un refus durable (salon absent ou non textuel, erreur
 * d'API codée — permission, salon inconnu), dont chaque nouvel essai ne ferait
 * qu'empiler des requêtes refusées chez Discord, et un envoi tenté sans
 * réponse claire (délai dépassé, coupure), qui a pu arriver. Le titulaire
 * n'est lu que pour l'avertir d'un accès refusé au salon. Ne lève jamais.
 * @param client Client Discord utilisé pour les appels API.
 * @param message Contenu du log.
 * @returns `false` si un nouvel essai peut réussir sans doublon, `true` sinon.
 */
async function sendLogConfirmed(client: Client, message: string): Promise<boolean> {
    let admin_channel: TextChannel | null;
    try {
        admin_channel = await client.channels.fetch(process.env.INFO_SERV as string) as TextChannel | null;
    } catch (error) {
        console.error("Erreur while reading the admin channel : ", describeError(error));
        return logRefusalHandled(client, error);
    }
    if (!admin_channel || typeof admin_channel.send !== "function")
        return true;
    try {
        await admin_channel.send(message);
        return true;
    } catch (error) {
        console.error("Erreur while sending to the admin channel : ", describeError(error));
        // Sans code Discord (délai dépassé, coupure), le message a pu arriver :
        // traité, pour ne pas le doubler au prochain essai.
        return discordJsonCode(error) === null || logRefusalHandled(client, error);
    }
}

/**
 * Suite d'un refus codé du salon de supervision : avertit le titulaire d'un
 * accès refusé (une fois par heure : chaque annonce abandonnée a sa propre clé
 * de signalement).
 * @returns `true` si le refus est durable (tout code sauf l'API surchargée),
 *   `false` sinon (erreur sans code, API surchargée : un nouvel essai peut passer).
 */
async function logRefusalHandled(client: Client, error: unknown): Promise<boolean> {
    const code = discordJsonCode(error);
    if (code === MISSING_ACCESS && Date.now() - lastOwnerNoticeAt >= OWNER_NOTICE_COOLDOWN_MS) {
        const previous = lastOwnerNoticeAt;
        lastOwnerNoticeAt = Date.now();
        let owner: User | null = null;
        try {
            owner = await client.users.fetch(process.env.OWNER_ID as string);
        } catch {
            // Titulaire illisible : rien n'est parti, le prochain signalement
            // retente l'avis.
            lastOwnerNoticeAt = previous;
        }
        // Un envoi qui échoue garde l'heure : refusé (messages privés
        // fermés), ou peut-être parti malgré l'erreur.
        await owner?.send("Missing Access to admin channel").catch(() => undefined);
    }
    return code !== null && code !== API_OVERLOADED;
}

/** Oublie le dernier avis au titulaire. Réservé aux tests. */
function resetOwnerNoticeThrottle(): void {
    lastOwnerNoticeAt = Number.NEGATIVE_INFINITY;
}

export { sendLog, sendLogConfirmed, resetOwnerNoticeThrottle };
