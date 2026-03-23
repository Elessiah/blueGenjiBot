import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {adhesionIntervalIds, adhesionIntervalObj} from "@/adhesion/types.js";
import {Client} from "discord.js";
import {sendAdhesion} from "@/adhesion/sendAdhesion.js";
import {fetchTargets} from "@/adhesion/fetchTargets.js";
import {sendLog} from "@/safe/sendLog.js";
import { removeIntervalle } from "./removeIntervalle.js";
import { toSQLiteDate } from "@/utils/toSQLiteDatetime.js";

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
        fetchedIntervalle.nextTransmission = new Date();
        fetchedIntervalle.nextTransmission.setDate(fetchedIntervalle.nextTransmission.getDate() + fetchedIntervalle.interval_days);
        fetchedIntervalle.nextTransmission.setHours(10, 0, 0,0);
        if (fetchedIntervalle.iteration != -1) {
            fetchedIntervalle.iteration--;
            if (fetchedIntervalle.iteration == 0) {
                await removeIntervalle(client, bdd, fetchedIntervalle.author, fetchedIntervalle.id, "Dernière itération du rappel n°" + fetchedIntervalle.id + " effectuée");
                continue;
            }
        }
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
