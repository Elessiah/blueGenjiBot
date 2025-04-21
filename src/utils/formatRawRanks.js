const rankChoices = require("../config/rankChoices");

async function formatRawRanks(rawRanks) {
    let prettyRanks = "";
    for (const rank of rawRanks) {
        for (const choice of rankChoices) {
            if (choice.value === rank) {
                prettyRanks += `- **${choice.name}**\n`;
            }
        }
    }
    return prettyRanks;
}

module.exports = formatRawRanks;