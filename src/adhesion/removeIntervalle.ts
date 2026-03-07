import {Client, User} from "discord.js";
import {Bdd} from "@/bdd/Bdd.js";
import {safeUser} from "@/safe/safeUser.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * Supprime une intervalle d'adhésion de la base et enregistre l'événement.
 * Peut aussi prevenir l'utilisateur concerne avec le message fourni.
 * @param client Client Discord utilisé pour les logs/notifications.
 * @param bdd Instance de base de données.
 * @param user Utilisateur à notifier, ou `undefined` pour ne pas notifier.
 * @param id Identifiant de l'intervalle à supprimer.
 * @param msg Message de contexte à envoyer dans les logs et notifications.
 */
async function removeIntervalle(client: Client, bdd: Bdd, user: User | undefined, id: number, msg: string): Promise<void> {
    await sendLog(client, msg);
    if (user) {
        await safeUser(client, user, undefined, undefined, msg)
    }
    await bdd.rm("AdhesionInterval", undefined, {query: "id = ?", values: [id]});
}

export {removeIntervalle};
