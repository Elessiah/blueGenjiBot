import {Client, User} from "discord.js";
import {Bdd} from "@/bdd/Bdd.js";
import {adhesionIntervalIds} from "@/adhesion/types.js";
import {removeIntervalle} from "@/adhesion/removeIntervalle.js";

/**
 * Contrôle si une intervalle possède encore au moins une cible valide.
 * Supprime l'intervalle de la base si toutes les cibles sont absentes.
 * @param client Client Discord utilisé pour la notification et les logs.
 * @param bdd Instance de base de données utilisée pour supprimer l'intervalle si besoin.
 * @param user Utilisateur à notifier, ou `undefined` si aucune notification n'est possible.
 * @param intervalle Intervalle d'adhésion à vérifier.
 */
async function checkTargets(client: Client, bdd: Bdd, user: User | undefined, intervalle: adhesionIntervalIds): Promise<void> {
    if (intervalle.member_id == null && intervalle.channel_id == null && intervalle.role_id == null) {
        await removeIntervalle(
            client,
            bdd,
            user,
            intervalle.id,
            "L'intervalle " + intervalle.id + " n'a plus de cible. Suppression...")
    }
}

export {checkTargets};
