import type {Bdd} from "../bdd/Bdd.js";

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