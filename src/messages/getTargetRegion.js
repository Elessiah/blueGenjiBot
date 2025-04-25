const {regions} = require("../utils/globals");
const {searchString} = require("../utils/searchString");

async function getTargetRegion(currentRegion, messageContentLower) {
    for (let i = regions.length - 1; i >= 0; i--) {
        if (await searchString(regions[i].toLowerCase(), messageContentLower)) {
            return i;
        }
    }
    return currentRegion;
}

module.exports = getTargetRegion;