import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {adhesionIntervalIds, adhesionIntervalObj} from "@/adhesion/types.js";
import {Client} from "discord.js";
import {sendAdhesion} from "@/adhesion/sendAdhesion.js";
import {fetchTargets} from "@/adhesion/fetchTargets.js";
import {sendLog} from "@/safe/sendLog.js";

async function checkIntervalleAdhesion(client: Client) {
    const bdd: Bdd = await getBddInstance();
    const intervals = await bdd.get(
        "AdhesionInterval",
        ["*"],
        undefined,
        {query: "nextTransmission <= DATETIME('now')", values: []}
    ) as adhesionIntervalIds[];
    if (intervals.length == 0)
        return;
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
        console.log("fetched intervalleNextTransmission: ", fetchedIntervalle.nextTransmission);
        await bdd.set(
            "AdhesionInterval",
            [
                "channel_id",
                "member_id",
                "role_id",
                "nextTransmission",
            ],
            [
                fetchedIntervalle.channel ? fetchedIntervalle.channel.id : null,
                fetchedIntervalle.member ? fetchedIntervalle.member.id : null,
                fetchedIntervalle.role ? fetchedIntervalle.role.id : null,
                fetchedIntervalle.nextTransmission.toISOString()
            ]
        );
    }
}

export {checkIntervalleAdhesion};