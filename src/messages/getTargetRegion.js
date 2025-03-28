const {regions} = require("../utils/enums");
const {searchString} = require("../utils/searchString");

async function getTargetRegion(currentRegion, messageContentLower) {
    for (let i = 0; i < regions.length; i++) {
        if (await searchString(regions[i].toLowerCase(), messageContentLower)) {
            return i;
        }
    }
    return currentRegion;
}

module.exports = getTargetRegion;