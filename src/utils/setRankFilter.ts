import type {Bdd} from "../bdd/Bdd.js";

/**
 * Applique le filtre de rangs demandé sur un salon/service.
 * @param bdd Instance de base de données.
 * @param channel_id Identifiant du salon cible.
 * @param rank_range Liste des IDs de rang à associer au salon.
 */
async function setRankFilter(bdd: Bdd,
                             channel_id: string,
                             rank_range: number[]): Promise<void>
{
    try {
        for (const rank of rank_range) {
            await bdd.set("ChannelPartnerRank", ["id_channel", "id_rank"], [channel_id, rank]);
        }
    } catch (e) {
        console.error("Error while setting rank filter : ", e);
    }
}

export {setRankFilter};
