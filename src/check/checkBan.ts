import type {Client, TextChannel, User} from "discord.js";

import type {Bdd} from "../bdd/Bdd.js";
import { getBddInstance} from "../bdd/Bdd.js";
import {safeUser} from "../safe/safeUser.js";
import {sendLog} from "../safe/sendLog.js";
import {banNoticeMessage} from "../notifications/dmLanguage.js";


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

/** Exclus dont un avis est en cours d'envoi : deux messages simultanés n'en font partir qu'un. */
const noticesInFlight = new Set<string>();

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
 * L'essai est daté **avant** les lectures : un essai qui échoue (messages
 * privés fermés, motif effacé) ne se répète pas non plus à chaque message.
 * Seul l'identifiant du message remis est gardé (`id_notice_user`), jamais un
 * nom : l'avis précédent est effacé quand un nouveau part, et le dernier à la
 * levée de l'exclusion (`deleteBanMessages`).
 * @param client Client Discord.
 * @param banInfo Ligne `Ban` de l'exclu.
 * @param now Instant de l'essai (ms).
 */
async function notifyBannedUser(client: Client, banInfo: BanInfo, now: number): Promise<void> {
    const lastTry = Number(banInfo.notice_user_at ?? 0);
    if (now - lastTry < BAN_NOTICE_INTERVAL_MS || noticesInFlight.has(banInfo.id_user)) {
        return;
    }
    noticesInFlight.add(banInfo.id_user);
    try {
        const bdd: Bdd = await getBddInstance();
        await bdd.update("Ban", {notice_user_at: now}, {id_user: banInfo.id_user});
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
        const sent = await safeUser(client, user, undefined, [], banReason);
        if (!sent) {
            return;
        }
        await bdd.update("Ban", {id_notice_user: sent.id}, {id_user: banInfo.id_user});
        if (banInfo.id_notice_user && banInfo.id_notice_user !== sent.id) {
            // Un seul avis à la fois dans la conversation : l'ancien n'a plus d'objet.
            await user.createDM()
                .then((dm) => dm.messages.delete(banInfo.id_notice_user!))
                .catch(() => undefined);
        }
    } finally {
        noticesInFlight.delete(banInfo.id_user);
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
    let banInfo: BanInfo | undefined;
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
    try {
        await notifyBannedUser(client, banInfo, now);
    } catch (error) {
        // Le verdict est déjà rendu : prévenir est un service, pas une condition.
        await sendLog(client, "Failed to notify banned user : " + (error as Error).message);
    }
    return "BANNED";
}

export {checkBan};
