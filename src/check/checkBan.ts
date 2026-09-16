import type {Client, TextChannel, User} from "discord.js";

import type {Bdd} from "../bdd/Bdd.js";
import { getBddInstance} from "../bdd/Bdd.js";
import {safeUser} from "../safe/safeUser.js";
import {sendLog} from "../safe/sendLog.js";


import type {BanInfo, BanVerdict} from "./types.js";

/**
 * Prévient un banni de son bannissement, au mieux.
 *
 * Isolé du verdict à dessein : toutes les lectures Discord qu'il fait peuvent
 * lever pour des raisons parfaitement ordinaires — compte supprimé
 * (`UnknownUser`), `INFO_SERV` mal renseigné ou salon effacé
 * (`UnknownChannel`), et surtout **message de motif effacé**
 * (`UnknownMessage`), un simple ménage dans le salon d'administration. Tant que
 * cette notification partageait le `try` du verdict, chacun de ces cas
 * débannissait silencieusement — un modérateur qui range son salon levait les
 * bannissements qu'il venait d'y motiver.
 */
async function notifyBannedUser(client: Client, banInfo: BanInfo): Promise<void> {
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
    const banReason = "You have been banned since " + banInfo.date + " : \n" + reasonMsg.content;
    await safeUser(client, user, undefined, [], banReason);
}

/**
 * Vérifie si un utilisateur est banni avant de poursuivre le traitement.
 * @param client Client Discord utilisé pour les appels API.
 * @param id_author Identifiant Discord de l'utilisateur à vérifier.
 * @param alertUser Si `true`, tente d'envoyer au banni un message privé avec la raison.
 * @returns `"BANNED"`, `"NOT_BANNED"`, ou `"UNKNOWN"` si la base n'a pas pu être lue — jamais un verdict inventé.
 */
async function checkBan(client: Client,
                        id_author: string,
                        alertUser: boolean = true): Promise<BanVerdict> {
    let banInfo: BanInfo | undefined;
    // Seule la **lecture du verdict** est gardée ici, et son échec ne rend pas
    // « pas banni » : voir `BanVerdict`. Tout ce qui suit est acquis.
    try {
        const bdd: Bdd = await getBddInstance();
        const result: BanInfo[] = (await bdd.get("Ban",
            ['id_user', 'id_reason', 'date'],
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
        await notifyBannedUser(client, banInfo);
    } catch (error) {
        // Le verdict est déjà rendu : prévenir est un service, pas une condition.
        await sendLog(client, "Failed to notify banned user : " + (error as Error).message);
    }
    return "BANNED";
}

export {checkBan};
