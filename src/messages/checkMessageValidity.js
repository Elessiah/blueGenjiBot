const {searchString} = require("../utils/searchString");
const checkBan = require("../check/checkBan");
const {checkCooldown} = require("../check/checkCooldown");
const safeMsgReply = require("../safe/safeMsgReply");
const delay = require("../utils/delay");
const answerTmp = require("../utils/answerTmp");

async function checkMessageValidity(client, service, messageContentLower, message, checkKeyword=true) {
    if (checkKeyword && await searchString(service.name.toLowerCase(), messageContentLower) === false) {
        return false;
    }
    if (await checkBan(client, message.author.id) === true) {
        await message.react("🚫");
        return false;
    }
    const cooldown = await checkCooldown(message.author.id, service.id_service);
    if (cooldown !== true) {
        await answerTmp(client, message, `You must wait ${cooldown} minutes before sending again a message on this service`, 30000);
        return false;
    }
    return true;
}

module.exports = checkMessageValidity;