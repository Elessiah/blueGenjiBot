import {Client, User} from "discord.js";
import {Bdd} from "@/bdd/Bdd.js";
import {adhesionIntervalIds} from "@/adhesion/types.js";
import {removeIntervalle} from "@/adhesion/removeIntervalle.js";

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