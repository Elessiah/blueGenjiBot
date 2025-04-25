const {regions} = require("../utils/globals");
const {searchString} = require("../utils/searchString");

async function getTargetRegion(currentRegion, messageContentLower) {
    for (let i = 1; i < regions.length; i++) { // 1 pour éviter de check ALL
        if (await searchString(regions[i].toLowerCase(), messageContentLower)) {
            return i;
        }
    }
    return currentRegion;
}

module.exports = getTargetRegion;