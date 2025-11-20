const sendLog = require("../safe/sendLog");
const answerTmp = require("../utils/answerTmp");
const { regions } = require("../utils/globals");
const { nextTips } = require("../utils/Tips");

async function manageServiceSuccess(client, bdd, message, targetedRegions, nbPartner, service) {
    const ret = await bdd.set("OGMsg", ['id_msg', 'id_author'], [message.id, message.author.id]);
    if (ret.success === false) {
        await sendLog(client, "In manageDistribution: " + ret.message);
    }
    await message.react("🛰️");
    let notifiedRegions = [];
    for (const region of targetedRegions)
        notifiedRegions.push(regions[region]);
    answerTmp(client, message, "Your message has been sent to " + nbPartner + " channels of " + notifiedRegions.join('/') + "/ALL region as " + service, 30000);
    await nextTips(client, service, targetedRegions);
}

module.exports = manageServiceSuccess;