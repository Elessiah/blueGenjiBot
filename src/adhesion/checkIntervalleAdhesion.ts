import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {adhesionIntervalIds, adhesionIntervalObj} from "@/adhesion/types.js";
import {Client} from "discord.js";
import {sendAdhesion} from "@/adhesion/sendAdhesion.js";
import {fetchTargets} from "@/adhesion/fetchTargets.js";
import {sendLog} from "@/safe/sendLog.js";
import { removeIntervalle } from "./removeIntervalle.js";
import { toSQLiteDate } from "@/utils/toSQLiteDatetime.js";
import { remainingIteration } from "@/adhesion/iteration.js";
import { nextTransmissionAfter } from "@/adhesion/nextTransmission.js";

/**
 * Vérifie les rappels d'adhésion arrives a échéance puis les envoie.
 * Met ensuite à jour la date du prochain envoi pour chaque intervalle traite.
 * @param client Client Discord utilisé pour récupérer les cibles et envoyer les messages.
 */
async function checkIntervalleAdhesion(client: Client) {
    const bdd: Bdd = await getBddInstance();
    const intervals = await bdd.get(
        "AdhesionInterval",
        ["*"],
        undefined,
        {query: "nextTransmission <= DATETIME('now')", values: []}
    ) as adhesionIntervalIds[];
    if (intervals.length == 0) {
        return;
    }
    for (const intervalle of intervals) {
        await sendLog(client, "Manage auto adhésion : " + intervalle.id);
        const fetchedIntervalle: adhesionIntervalObj | null = await fetchTargets(client, bdd, intervalle);
        if (!fetchedIntervalle)
            continue;
        await sendAdhesion(
            client,
            fetchedIntervalle.message,
            fetchedIntervalle.channel,
            fetchedIntervalle.member,
            fetchedIntervalle.role,
            false,
            fetchedIntervalle.author
        );
        // Le décompte est décidé **avant** d'être écrit, et par une seule
        // règle. L'enchaînement d'avant — `iteration--` puis `== 0` — laissait
        // passer le zéro, qui devenait `-1` : un rappel à bout d'envois se
        // réécrivait en rappel **sans fin**, et plus rien ne l'arrêtait.
        const remaining: number | null = remainingIteration(fetchedIntervalle.iteration);
        if (remaining === null) {
            await removeIntervalle(client, bdd, fetchedIntervalle.author, fetchedIntervalle.id, "Dernière itération du rappel n°" + fetchedIntervalle.id + " effectuée");
            continue;
        }
        fetchedIntervalle.iteration = remaining;
        fetchedIntervalle.nextTransmission = nextTransmissionAfter(new Date(), fetchedIntervalle.interval_days);
        await bdd.update(
            "AdhesionInterval",
            {
                "channel_id" : fetchedIntervalle.channel ? fetchedIntervalle.channel.id : null,
                "member_id" : fetchedIntervalle.member ? fetchedIntervalle.member.id : null,
                "role_id" : fetchedIntervalle.role ? fetchedIntervalle.role.id : null,
                "nextTransmission" : toSQLiteDate(fetchedIntervalle.nextTransmission),
                "iteration" : fetchedIntervalle.iteration,
            },
            {
                "id": fetchedIntervalle.id,
            }
        );
    }
}

export {checkIntervalleAdhesion};
