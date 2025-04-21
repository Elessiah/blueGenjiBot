const { ranksMatch, ranks} = require('./globals');
const normalizeText = require("./normalizeText");

async function extractRanks(message) {
    let matchs = [];
    const cleanMessage = normalizeText(message);
    for (const [key, value] of Object.entries(ranksMatch)) {
        const regex = new RegExp(`\\b${key}\\b`, 'i');
        if (regex.test(cleanMessage)) {
            matchs.push(value);
        }
    }
    if (matchs.length === 0) {
        matchs = ranks;
    }
    return matchs;
}

module.exports = extractRanks;