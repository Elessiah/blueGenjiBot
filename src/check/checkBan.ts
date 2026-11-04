import type {Client, TextChannel, User} from "discord.js";

import type {Bdd} from "../bdd/Bdd.js";
import { getBddInstance} from "../bdd/Bdd.js";
import {safeUser} from "../safe/safeUser.js";
import {sendLog} from "../safe/sendLog.js";
import {banNoticeMessage} from "../notifications/dmLanguage.js";
import {errorCode} from "../safe/errorGuards.js";


import type {BanInfo, BanVerdict} from "./types.js";

/**
 * Intervalle minimal entre deux avis d'exclusion à un même exclu.
 *
 * Chaque message relayé d'un exclu passe par `checkBan` : sans borne, un exclu
 * qui écrit en boucle déclenchait autant de lectures Discord (compte, salon,
 * motif) et de messages privés (trois essais de `safeUser` chacun). Un avis par
 * jour suffit à lui rappeler l'exclusion.
 */
export const BAN_NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Attend la fin des avis d'exclusion partis en arrière-plan (un arrêt du bot
 * en plein envoi perd l'avis du jour, au mieux par nature).
 * @returns Une promesse qui se résout quand la file est vide.
 */
export async function settleBanNotices(): Promise<void> {
    // Un avis mis en file pendant l'attente allonge la file : on attend jusqu'à sa fin.
    let tail: Promise<unknown>;
    do {
        tail = noticeQueue;
        await tail;
    } while (tail !== noticeQueue);
}

/** Exclus dont un avis est en file ou en cours d'envoi : deux messages simultanés n'en font partir qu'un. */
const noticesInFlight = new Set<string>();

/**
 * Nombre maximal d'avis en file (en cours compris).
 *
 * Après un redémarrage, tous les `notice_user_at` peuvent être périmés : sans
 * plafond, chaque exclu qui écrit lançait sa demi-douzaine d'appels Discord en
 * même temps que les autres, sur la file REST que partage le relais. Au-delà,
 * l'avis n'est pas réservé : il partira à un message suivant, file dégagée.
 */
export const MAX_QUEUED_BAN_NOTICES = 20;

/** Fin du dernier avis mis en file : les avis partent **un à la fois**. */
let noticeQueue: Promise<unknown> = Promise.resolve();

/**
 * Durée de vie d'un verdict « exclu » gardé en mémoire pour le relais.
 *
 * Seul le verdict positif est gardé, et seulement pour les messages relayés
 * (`alertUser`) : une exclusion prononcée vaut sur-le-champ (« pas exclu »
 * n'est jamais gardé), `/ban` et les interactions relisent toujours la base, et
 * `/unban` oublie le verdict ({@link forgetBanVerdict}). Une levée faite hors de
 * `/unban` (restauration de la base) bloque au pire une minute de plus.
 */
export const BAN_VERDICT_CACHE_MS = 60 * 1000;

/** Plafond d'entrées du cache des verdicts : au-delà, la plus ancienne part. */
const BAN_VERDICT_CACHE_MAX = 1000;

/** Verdicts « exclu » récents, par compte : la ligne lue et l'instant de lecture. */
const banVerdictCache = new Map<string, {banInfo: BanInfo; readAt: number}>();

/**
 * Nombre d'oublis faits jusqu'ici : une lecture commencée avant un oubli (une
 * levée pendant la lecture) ne remet pas en cache le verdict qu'il vient d'effacer.
 */
let forgetGeneration = 0;

/**
 * Oublie le verdict « exclu » gardé pour un compte (ou pour tous).
 * @param idUser Compte dont l'exclusion vient d'être levée ; tous si absent.
 */
export function forgetBanVerdict(idUser?: string): void {
    forgetGeneration += 1;
    if (idUser === undefined) {
        banVerdictCache.clear();
    } else {
        banVerdictCache.delete(idUser);
    }
}

/**
 * Lit le verdict gardé encore valide pour un compte.
 * @param idUser Compte vérifié.
 * @param now Instant de la vérification (ms).
 * @returns La ligne `Ban` gardée, ou `undefined` si rien de valide.
 */
function cachedBan(idUser: string, now: number): BanInfo | undefined {
    const entry = banVerdictCache.get(idUser);
    if (!entry) {
        return undefined;
    }
    // Un instant antérieur à la lecture (horloge reculée) ne prolonge rien.
    if (now < entry.readAt || now - entry.readAt >= BAN_VERDICT_CACHE_MS) {
        banVerdictCache.delete(idUser);
        return undefined;
    }
    return entry.banInfo;
}

/**
 * Garde un verdict « exclu » lu en base.
 *
 * Une entrée encore valide est gardée telle quelle : c'est l'objet que l'avis
 * en cours tient à jour, deux lectures simultanées n'en font pas deux copies.
 * @param banInfo Ligne `Ban` lue.
 * @param now Instant de la lecture (ms).
 * @param generation Valeur de `forgetGeneration` au début de la lecture.
 * @returns La ligne à utiliser : celle du cache si elle existe, sinon `banInfo`.
 */
function rememberBan(banInfo: BanInfo, now: number, generation: number): BanInfo {
    if (generation !== forgetGeneration) {
        // Un oubli (levée) est passé pendant la lecture : rien n'est gardé.
        return banInfo;
    }
    const kept = cachedBan(banInfo.id_user, now);
    if (kept) {
        return kept;
    }
    if (banVerdictCache.size >= BAN_VERDICT_CACHE_MAX) {
        // Ordre d'insertion : la première clé est la plus ancienne lecture.
        const oldest = banVerdictCache.keys().next().value;
        if (oldest !== undefined) {
            banVerdictCache.delete(oldest);
        }
    }
    banVerdictCache.set(banInfo.id_user, {banInfo, readAt: now});
    return banInfo;
}

/**
 * Prévient un banni de son bannissement, au mieux, au plus une fois par
 * {@link BAN_NOTICE_INTERVAL_MS}.
 *
 * Isolé du verdict à dessein : toutes les lectures Discord qu'il fait peuvent
 * lever pour des raisons parfaitement ordinaires — compte supprimé
 * (`UnknownUser`), `INFO_SERV` mal renseigné ou salon effacé
 * (`UnknownChannel`), et surtout **message de motif effacé**
 * (`UnknownMessage`), un simple ménage dans le salon d'administration. Tant que
 * cette notification partageait le `try` du verdict, chacun de ces cas
 * débannissait silencieusement — un modérateur qui range son salon levait les
 * bannissements qu'il venait d'y motiver.
 *
 * L'essai est **réservé en une instruction** (`UPDATE … WHERE notice_user_at`
 * périmé), avant les lectures : deux messages rapprochés n'envoient qu'un avis,
 * et un essai qui échoue (messages privés fermés, motif effacé) ne se répète
 * pas non plus à chaque message. Si l'exclusion est levée pendant l'envoi
 * (ligne disparue), l'avis tout juste remis est aussitôt effacé.
 * Seul l'identifiant du message remis est gardé (`id_notice_user`), jamais un
 * nom : l'avis précédent est effacé quand un nouveau part, et le dernier à la
 * levée de l'exclusion (`deleteBanMessages`).
 * @param client Client Discord.
 * @param banInfo Ligne `Ban` de l'exclu.
 * @param now Instant de l'essai (ms).
 */
async function notifyBannedUser(client: Client, banInfo: BanInfo, now: number): Promise<void> {
    const bdd: Bdd = await getBddInstance();
    const claimed = await bdd.write(
        "UPDATE Ban SET notice_user_at = ? WHERE id_user = ? AND (notice_user_at IS NULL OR notice_user_at <= ? OR notice_user_at > ?)",
        [now, banInfo.id_user, now - BAN_NOTICE_INTERVAL_MS, now]);
    if (claimed === 0) {
        // Ligne disparue (levée) ou avis déjà réservé ailleurs : le verdict gardé n'est plus sûr.
        forgetBanVerdict(banInfo.id_user);
        return;
    }
    // Le verdict gardé suit la base : les messages suivants voient l'essai du jour.
    banInfo.notice_user_at = now;
    // L'avis précédent est celui que `checkBan` vient de lire : la réservation
    // réussie prouve qu'aucun autre n'est parti depuis (il aurait renouvelé `notice_user_at`).
    const previousNotice = banInfo.id_notice_user ?? null;
    const user: User = await client.users.fetch(banInfo.id_user);
    const logChannel: TextChannel = await client.channels.fetch(process.env.INFO_SERV!) as TextChannel;
    if (!logChannel) {
        await sendLog(client, "Failed to fetch admin channel for ban reason");
        return;
    }
    const reasonMsg = await logChannel.messages.fetch(banInfo.id_reason);
    if (!reasonMsg) {
        await sendLog(client, "Failed to fetch ban reason in admin channel");
        return;
    }
    const banReason = banNoticeMessage(banInfo.date, reasonMsg.content);
    // Un seul avis à la fois dans la conversation : l'ancien est effacé **avant**
    // l'envoi. S'il ne peut pas l'être (Discord indisponible), rien ne part : son
    // identifiant, seul moyen de l'effacer à la levée, n'est pas écrasé.
    if (previousNotice && !(await deleteNotice(user, previousNotice))) {
        return;
    }
    const sent = await safeUser(client, user, undefined, [], banReason);
    if (!sent) {
        return;
    }
    const stored = await bdd.write("UPDATE Ban SET id_notice_user = ? WHERE id_user = ?", [sent.id, banInfo.id_user]);
    if (stored === 0) {
        // Exclusion levée pendant l'envoi : l'avis (et son motif) ne doit pas rester.
        forgetBanVerdict(banInfo.id_user);
        await deleteNotice(user, sent.id);
        return;
    }
    banInfo.id_notice_user = sent.id;
}

/** Code Discord d'un message inconnu : déjà effacé, rien à garder. */
const UNKNOWN_MESSAGE = 10008;

/**
 * Efface un avis remis à l'exclu.
 * @param user Exclu.
 * @param messageId Identifiant de l'avis.
 * @returns `true` si l'avis n'existe plus (effacé, ou déjà absent).
 */
async function deleteNotice(user: User, messageId: string): Promise<boolean> {
    try {
        const dm = user.dmChannel ?? await user.createDM();
        await dm.messages.delete(messageId);
        return true;
    } catch (error) {
        return errorCode(error) === UNKNOWN_MESSAGE;
    }
}

/**
 * Vérifie si un utilisateur est banni avant de poursuivre le traitement.
 * @param client Client Discord utilisé pour les appels API.
 * @param id_author Identifiant Discord de l'utilisateur à vérifier.
 * @param alertUser Si `true`, envoie au banni un message privé avec la raison (au plus un par jour).
 * @param now Instant de la vérification (ms), pour les tests.
 * @returns `"BANNED"`, `"NOT_BANNED"`, ou `"UNKNOWN"` si la base n'a pas pu être lue — jamais un verdict inventé.
 */
async function checkBan(client: Client,
                        id_author: string,
                        alertUser: boolean = true,
                        now: number = Date.now()): Promise<BanVerdict> {
    let banInfo: BanInfo | undefined = alertUser ? cachedBan(id_author, now) : undefined;
    const generation = forgetGeneration;
    if (banInfo) {
        startBanNotice(client, banInfo, now);
        return "BANNED";
    }
    // Seule la **lecture du verdict** est gardée ici, et son échec ne rend pas
    // « pas banni » : voir `BanVerdict`. Tout ce qui suit est acquis.
    try {
        const bdd: Bdd = await getBddInstance();
        const result: BanInfo[] = (await bdd.get("Ban",
            ['id_user', 'id_reason', 'date', 'id_notice_user', 'notice_user_at'],
            {},
            {query: "id_user = ?", values: [id_author]}) as BanInfo[]);
        banInfo = result[0];
    } catch (e) {
        await sendLog(client, "Failed to check ban : " + (e as Error).message);
        return "UNKNOWN";
    }
    if (!banInfo) {
        return "NOT_BANNED";
    }
    if (!alertUser) {
        return "BANNED";
    }
    startBanNotice(client, rememberBan(banInfo, now, generation), now);
    return "BANNED";
}

/**
 * Met en file l'avis d'un exclu quand il est dû, sans l'attendre.
 * @param client Client Discord.
 * @param banInfo Ligne `Ban` de l'exclu (celle du cache, tenue à jour par l'avis).
 * @param now Instant de la vérification (ms).
 */
function startBanNotice(client: Client, banInfo: BanInfo, now: number): void {
    // Le verdict est déjà rendu : prévenir est un service, pas une condition, et
    // il coûte une demi-douzaine d'appels Discord séquentiels. Il part donc en
    // arrière-plan, au plus une fois par jour : le message relayé n'attend pas.
    // Rien à faire dans l'intervalle : aucune promesse n'est créée pour les messages suivants.
    // Un instant dans le futur (horloge reculée) ne bloque pas l'avis : il est périmé.
    const elapsed = now - Number(banInfo.notice_user_at ?? 0);
    if ((elapsed >= 0 && elapsed < BAN_NOTICE_INTERVAL_MS) || noticesInFlight.has(banInfo.id_user)
        || noticesInFlight.size >= MAX_QUEUED_BAN_NOTICES) {
        return;
    }
    const idUser = banInfo.id_user;
    noticesInFlight.add(idUser);
    const notice: Promise<unknown> = noticeQueue
        .then(() => notifyBannedUser(client, banInfo, now))
        .catch((error: unknown) => sendLog(client, "Failed to notify banned user : " + (error as Error).message))
        .catch(() => undefined)
        .finally(() => noticesInFlight.delete(idUser));
    noticeQueue = notice;
}

export {checkBan};
