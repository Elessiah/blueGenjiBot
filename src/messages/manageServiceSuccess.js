const sendLog = require("../safe/sendLog");
const answerTmp = require("../utils/answerTmp");
const { regions } = require("../utils/globals");
const { nextTips } = require("../utils/Tips");

async function manageServiceSuccess(client, bdd, message, target_region, nbPartner, usedServices) {
    const ret = await bdd.set("OGMsg", ['id_msg', 'id_author'], [message.id, message.author.id]);
    if (ret.success === false) {
        await sendLog(client, "In manageDistribution: " + ret.message);
    }
    await message.react("🛰️");
    answerTmp(client, message, "Your message has been sent to " + nbPartner + " channels of " + regions[target_region] + "/ALL region as " + usedServices.join(', '), 30000);
    await nextTips(client, usedServices, target_region);
}

module.exports = manageServiceSuccess;