const { ranksMatch, ranks} = require('./globals');
const normalizeText = require("./normalizeText");
const sendLog = require("../safe/sendLog");
const safeMsgReply = require("../safe/safeMsgReply");
const answerTmp = require("./answerTmp");

async function extractRanks(client, message) {
    let matchs = [];
    const cleanMessage = normalizeText(message.content);
    for (const [key, value] of Object.entries(ranksMatch)) {
        const safeKey = key.replace(/\s+/g, '\\s*');
        const regex = new RegExp(`\\b${safeKey}\\s*\\d*\\b`, 'i');
        if (regex.test(cleanMessage)) {
            matchs.push(value);
        }
    }
    if (matchs.length === 0) {
        await sendLog(client, "Did not find any rank : " + message.content);
        answerTmp(client,
            message,
            "It seems that you didn't specify any rank. To get more responses from other users, I recommend specifying the rank range you're looking for.",
            30000);
        matchs = ranks;
    }
    return matchs;
}

module.exports = extractRanks;