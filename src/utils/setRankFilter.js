async function setRankFilter(bdd, channel_id, rank_range)
{
    try {
        for (const rank of rank_range) {
            await bdd.set("ChannelPartnerRank", ["id_channel", "id_rank"], [channel_id, rank]);
        }
    } catch (e) {
        console.error("Error while setting rank filter : ", e);
    }
}

module.exports = setRankFilter;