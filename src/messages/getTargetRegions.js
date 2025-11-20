const {regions} = require("../utils/globals");
const {searchString} = require("../utils/searchString");

async function getTargetRegions(currentRegion, messageContentLower) {
    let requestedRegions = [];
    let query = "";
    for (let i = 1; i < regions.length; i++) { // 1 pour éviter de check ALL
        if (await searchString(regions[i].toLowerCase(), messageContentLower)) {
            requestedRegions.push(i);
            if (query.length > 0)
                query += " OR ";
            query += "ChannelPartner.region = " + i;
        }
    }
    if (requestedRegions.length === 0 && currentRegion !== 0) {
        requestedRegions.push(currentRegion);
        query += "ChannelPartner.region = " + currentRegion;
    } else if (currentRegion === 0)
        return null;
    return {query: query, requestedRegions: requestedRegions};
}

module.exports = getTargetRegions;