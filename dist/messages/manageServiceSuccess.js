import { sendLog } from "../safe/sendLog.js";
import { answerTmp } from "../utils/answerTmp.js";
import { regions } from "../utils/globals.js";
import { nextTips } from "../utils/Tips.js";
async function manageServiceSuccess(client, bdd, message, targetedRegions, nbPartner, service) {
    const ret = await bdd.set("OGMsg", ['id_msg', 'id_author'], [message.id, message.author.id]);
    if (!ret.success) {
        await sendLog(client, "In manageDistribution: " + ret.message);
    }
    await message.react("🛰️");
    let notifiedRegions = [];
    for (const region of targetedRegions)
        notifiedRegions.push(regions[region]);
    answerTmp(client, message, "Your message has been sent to " + nbPartner + " channels of " + notifiedRegions.join('/') + "/ALL region as " + service, 30000);
    for (const region of targetedRegions)
        await nextTips(client, service, region);
}
export { manageServiceSuccess };
//# sourceMappingURL=manageServiceSuccess.js.map