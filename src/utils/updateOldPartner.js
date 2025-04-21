const { ranks } = require("./globals");
const setRankFilter = require("./setRankFilter");
const defineRankRange = require("./defineRankRange");

async function updateOldPartner(bdd){
    console.log("Remember to remove me later !");
    let result_request = await bdd.get("ChannelPartner", ["id_channel"]);
    if (!result_request || result_request.length === 0) {
        console.error("No partner to update");
        return false;
    }
    const rank_range = await defineRankRange(ranks[0], ranks[ranks.length - 1]);
    const partners = await result_request.map(obj => Object.values(obj));
    for (const partner of partners) {
        result_request = await bdd.get("ChannelPartnerRank", ["id_channel"], {}, {"ChannelPartnerRank.id_channel": partner[0]});
        if (result_request == null || result_request.length === 0) {
            await setRankFilter(bdd, partner[0], rank_range);
        }
    }
}

module.exports = updateOldPartner;