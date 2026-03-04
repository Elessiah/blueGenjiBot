import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {adhesionIntervalIds, adhesionIntervalObj} from "@/adhesion/types.js";
import {Client} from "discord.js";
import {sendAdhesion} from "@/adhesion/sendAdhesion.js";
import {fetchTargets} from "@/adhesion/fetchTargets.js";

async function checkIntervalleAdhesion(client: Client) {
    const bdd: Bdd = await getBddInstance();
    const intervals = await bdd.get(
        "AdhesionInterval",
        ["*"],
        undefined,
        {query: "nextTransmission <= DATE('now')", values: []}
    ) as adhesionIntervalIds[];
    if (intervals.length == 0)
        return;
    for (const intervalle of intervals) {
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
        fetchedIntervalle.nextTransmission.setDate(fetchedIntervalle.nextTransmission.getDate() + fetchedIntervalle.interval_days);
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