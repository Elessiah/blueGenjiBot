const sendLog = require("../safe/sendLog");
const safeMsgReply = require("../safe/safeMsgReply");
const manageMsgExpiration = require("./manageMsgExpiration");
const checkMessageValidity = require("./checkMessageValidity");
const getTargetRegion = require("./getTargetRegion");
const buildServiceMessage = require("./buildServiceMessage");
const sendServiceMessage = require("./sendServiceMessage");
const manageServiceSuccess = require("./manageServiceSuccess");
const extractRanks = require("../utils/extractRanks");
const answerTmp = require("../utils/answerTmp");

async function manageDistribution(message, client, bdd, channelId, services) {
    try {
        let attachement = "";
        if (message.attachments.size === 1) {
            attachement = message.attachments.values().next().value.attachment;
        } else if (message.attachments.size > 1) {
            await answerTmp(client,
                message,
                "You cannot send more than one attachment ! Cancel your Distribution.",
                30000);
            return false;
        };
        const ranks = await extractRanks(client, message);
        const embed = await buildServiceMessage(client, message, channelId, attachement);
        const messageContentLower = message.content.toLowerCase();
        const current_region = (await bdd.get("ChannelPartner", ["region"], {}, {id_channel: channelId}))[0].region;
        const target_region = await getTargetRegion(current_region, messageContentLower);
        if (target_region === 0) {
            await answerTmp(client,
                message,
                "Note that your message will only be delivered to channels without filters.\n" +
                "To target your ad more precisely, specify a region. Available regions: `EU, NA, LATAM, ASIA.`",
                30000);
        }
        let nbPartner = 0;
        let hasTried = false;
        let checkKeyword = true;
        if (services.length === 1) {
            checkKeyword = false;
        }
        const usedServices = [];
        for (const service of services) {
            if (await checkMessageValidity(client, service, messageContentLower, message, checkKeyword)) {
                usedServices.push(service.name);
                hasTried = true;
                await bdd.set('MessageService', ['id_msg', 'id_service'], [message.id, service.id_service]);
                const targets = await bdd.Database.all(`SELECT ChannelPartnerService.id_channel
                                            FROM ChannelPartnerService
                                                     JOIN Service ON ChannelPartnerService.id_service = Service.id_service
                                                     JOIN ChannelPartner
                                                          ON ChannelPartnerService.id_channel = ChannelPartner.id_channel
                                            WHERE Service.name = ?
                                              AND (ChannelPartner.region = ? OR ChannelPartner.region = 0)`,
                                        [service.name, target_region]);
                nbPartner += await sendServiceMessage(client, targets, message, embed, bdd, ranks);
            }
        }
        if (nbPartner > 0) {
            await manageServiceSuccess(client, bdd, message, target_region, nbPartner, usedServices);
        } else if (hasTried) {
            await answerTmp(client,
                message,
                "Your message was not delivered to any channel. " +
                "This may be because no users have activated the region filter you specified.",
                30000);
        }
        await manageMsgExpiration(client);
    } catch (err) {
        console.error(err);
        await sendLog(client, "manageDistribution error : \n" + err.message);
    }
}

module.exports = manageDistribution;