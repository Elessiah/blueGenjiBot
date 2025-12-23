import { sendLog } from "../safe/sendLog.js";
import { manageMsgExpiration } from "./manageMsgExpiration.js";
import { checkMessageValidity } from "./checkMessageValidity.js";
import { getTargetRegions } from "./getTargetRegions.js";
import { buildServiceMessage } from "./buildServiceMessage.js";
import { sendServiceMessage } from "./sendServiceMessage.js";
import { manageServiceSuccess } from "./manageServiceSuccess.js";
import { extractRanks } from "../utils/extractRanks.js";
import { answerTmp } from "../utils/answerTmp.js";
import { servicesWithNoRanks } from "../utils/servicesWithNoRanks.js";
import { getServicesAndID } from "../utils/getServiceAndID.js";
import { safeMsgReply } from "../safe/safeMsgReply.js";
async function manageDistribution(message, client, bdd, channelId, channelServices) {
    try {
        let attachementContent = undefined;
        if (message.attachments.size == 1) {
            const attachement = message.attachments.values().next();
            if (!attachement) {
                answerTmp(client, message, "Internal error. Sorry it failed to retrieved the attachment ! Try again. Your message was not send.", 10);
                return false;
            }
            attachementContent = attachement.value.attachment;
        }
        else if (message.attachments.size > 1) {
            answerTmp(client, message, "You cannot send more than one attachment ! Cancel your Distribution.", 30000);
            return false;
        }
        const services = await getServicesAndID();
        const silence = await servicesWithNoRanks(channelServices);
        const ranks = await extractRanks(client, message, silence);
        const embed = await buildServiceMessage(client, message, channelId, attachementContent);
        const messageContentLower = message.content.toLowerCase();
        const partnerRegions = await bdd.get("ChannelPartner", ["region"], {}, { query: "id_channel = ?", values: [channelId] });
        let current_region = 0;
        if (partnerRegions.length > 0) {
            current_region = partnerRegions[0].region;
        }
        let targetedRegions = await getTargetRegions(current_region, messageContentLower);
        if (targetedRegions == null) {
            answerTmp(client, message, "Note that your message will only be delivered to channels without filters.\n" +
                "To target your ad more precisely, specify a region. Available regions: `EU, NA, LATAM, ASIA.`", 30000);
            targetedRegions = { query: "ChannelPartner.region = 0", requestedRegions: [0] };
        }
        let nbPartner = 0;
        const hasValidService = { value: false };
        let targetedService = null;
        for (const service of services) {
            if (await checkMessageValidity(client, service, messageContentLower, message, hasValidService)) {
                if (!targetedService) {
                    targetedService = service;
                }
                else {
                    await safeMsgReply(client, message, "Your message has not been sent ! \n" +
                        "# Sending to multiple services is strictly prohibited.\n" +
                        "If necessary, split your request and send it in parts. **Spamming may result in a bot ban.**");
                    await message.react('🚫');
                    return false;
                }
            }
        }
        if (!targetedService) {
            answerTmp(client, message, "Your message has no keyword for a targeted service. Please, next time, use these keywords:\n" +
                " - `lfs`: If you are looking for a scrim.\n" +
                " - `lfp`: If you are looking for **players for your team to play tournaments and scrims**.\n" +
                " - `lfg`: If you are looking for **players to play ranked, quickplay, or chill with**.\n" +
                " - `lft`: If you are looking for **a team to play tournaments and scrims**.\n" +
                " - `lfsub`: If you are looking for a last-minute player for tournaments or scrims.\n" +
                " - `ta`: If you want to promote your tournament.\n" +
                " - `lfstaff`: If you are looking for staff for a team or organization, like a coach or admin.\n" +
                " - `lfcast`: If you are looking for casters to animate your tournament.\n", 120000);
        }
        await bdd.set('MessageService', ['id_msg', 'id_service'], [message.id, targetedService.id_service]);
        const targets = await bdd.get("ChannelPartnerService", ["id_channel"], { Service: "ChannelPartnerService.id_service = Service.id_service",
            ChannelPartner: "ChannelPartnerService.id_service = ChannelPartner.id_channel" }, { query: `Service.name = ? AND (${targetedRegions.query} OR ChannelPartner.region = 0)`,
            values: [targetedService.name] });
        /*
        const targets: {id_channel: string}[] = await bdd.Database!.all(`SELECT ChannelPartnerService.id_channel
                                                        FROM ChannelPartnerService
                                                                 JOIN Service ON ChannelPartnerService.id_service = Service.id_service
                                                                 JOIN ChannelPartner
                                                                      ON ChannelPartnerService.id_channel = ChannelPartner.id_channel
                                                        WHERE Service.name = ?
                                                          AND (${targetedRegions.query} OR ChannelPartner.region = 0);`,
                                                [targetedService.name]) as {id_channel: string}[];
         */
        nbPartner += await sendServiceMessage(client, targets, message, embed, bdd, ranks);
        if (nbPartner > 0) {
            await manageServiceSuccess(client, bdd, message, targetedRegions.requestedRegions, nbPartner, targetedService.name);
        }
        else if (targetedService) {
            answerTmp(client, message, "Your message was not delivered to any channel. " +
                "This may be because no users have activated the region filter you specified.", 30000);
        }
        await manageMsgExpiration(client);
        return true;
    }
    catch (err) {
        console.error(err);
        await sendLog(client, "manageDistribution error : \n" + err.message);
        return false;
    }
}
export { manageDistribution };
//# sourceMappingURL=manageDistribution.js.map