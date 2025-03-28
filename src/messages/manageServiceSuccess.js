const sendLog = require("../safe/sendLog");
const safeMsgReply = require("../safe/safeMsgReply");
const {regions} = require("../utils/enums");
const delay = require("../utils/delay");

async function manageServiceSuccess(client, bdd, message, target_region, nbPartner) {
    const ret = await bdd.set("OGMsg", ['id_msg', 'id_author'], [message.id, message.author.id]);
    if (ret.success === false) {
        await sendLog(client, "In manageDistribution: " + ret.message);
    }
    await message.react("🛰️");
    const temp_msg = await safeMsgReply(client, message, "Your message has been sent to " + nbPartner + " channels of " + regions[target_region] + "/ALL region !");
    await delay(30000);
    await temp_msg.delete();
}

module.exports = manageServiceSuccess;