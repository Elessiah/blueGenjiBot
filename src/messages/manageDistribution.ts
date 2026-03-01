import {sendLog} from "../safe/sendLog.js";
import {manageMsgExpiration} from "./manageMsgExpiration.js";
import {checkMessageValidity} from "./checkMessageValidity.js";
import {getTargetRegions} from "./getTargetRegions.js";
import {buildServiceMessage} from "./buildServiceMessage.js";
import {sendServiceMessage} from "./sendServiceMessage.js";
import {manageServiceSuccess} from "./manageServiceSuccess.js";
import {extractRanks} from "../utils/extractRanks.js";
import {answerTmp} from "../utils/answerTmp.js";
import {servicesWithNoRanks} from "../utils/servicesWithNoRanks.js";
import {getServicesAndID} from "../utils/getServiceAndID.js";
import {safeMsgReply} from "../safe/safeMsgReply.js";
import type {Attachment, Client, EmbedBuilder, Message} from "discord.js";
import type {Bdd} from "../bdd/Bdd.js";
import type {Service} from "../bdd/types.js";

async function manageDistribution(message: Message,
                                  client: Client,
                                  bdd: Bdd,
                                  channelId: string,
                                  channelServices: {name: string; id_service: number}[]): Promise<boolean> {
    try {
        let attachementContent: Attachment | undefined = undefined;
        if (message.attachments.size == 1) {
            const attachement: IteratorResult<Attachment | undefined> = message.attachments.values().next()
            if (!attachement) {
                answerTmp(client, message, "Internal error. Sorry it failed to retrieved the attachment ! Try again. Your message was not send.", 10);
                return false;
            }
            attachementContent = attachement.value.attachment;
        } else if (message.attachments.size > 1) {
            answerTmp(client,
                message,
                "You cannot send more than one attachment ! Cancel your Distribution.",
                30000);
            return false;
        }
        const services: Service[] = await getServicesAndID();
        const silence: boolean = await servicesWithNoRanks(channelServices);
        const ranks: string[] = await extractRanks(client, message, silence);
        const embed: EmbedBuilder = await buildServiceMessage(client, message, channelId, attachementContent);
        const messageContentLower: string = message.content.toLowerCase();
        const partnerRegions: {region: number}[] = await bdd.get("ChannelPartner", ["region"], {}, {query: "id_channel = ?", values: [channelId]}) as {region: number}[];
        let current_region: number = 0;
        if (partnerRegions.length > 0)
            {current_region = partnerRegions[0].region;}
        let targetedRegions: {query: string, requestedRegions: number[]} | null = await getTargetRegions(current_region, messageContentLower);
        if (targetedRegions == null) {
            answerTmp(client,
                message,
                "Note that your message will only be delivered to channels without filters.\n" +
                "To target your ad more precisely, specify a region. Available regions: `EU, NA, LATAM, ASIA.`",
                30000);
            targetedRegions = {query: "ChannelPartner.region = 0", requestedRegions: [0]};
        }
        let nbPartner: number = 0;
        const hasValidService: {value: boolean} = {value: false};
        let targetedService: Service | null = null;
        for (const service of services) {
            if (await checkMessageValidity(client, service, messageContentLower, message, hasValidService)) {
                if (!targetedService) {
                    targetedService = service;
                } else {
                    await safeMsgReply(client, message, "Your message has not been sent ! \n" +
                        "# Sending to multiple services is strictly prohibited.\n" +
                        "If necessary, split your request and send it in parts. **Spamming may result in a bot ban.**");
                    await message.react('🚫');
                    return false;
                }
            }
        }
        if (!targetedService) {
            answerTmp(client,
                message,
                "Your message has no keyword for a targeted service. Please, next time, use these keywords:\n" +
                " - `lfs`: If you are looking for a scrim.\n" +
                " - `lfp`: If you are looking for **players for your team to play tournaments and scrims**.\n" +
                " - `lfg`: If you are looking for **players to play ranked, quickplay, or chill with**.\n" +
                " - `lft`: If you are looking for **a team to play tournaments and scrims**.\n" +
                " - `lfsub`: If you are looking for a last-minute player for tournaments or scrims.\n" +
                " - `ta`: If you want to promote your tournament.\n" +
                " - `lfstaff`: If you are looking for staff for a team or organization, like a coach or admin.\n" +
                " - `lfcast`: If you are looking for casters to animate your tournament.\n",
                120000);
            return false;
        }
        await bdd.set('MessageService', ['id_msg', 'id_service'], [message.id, targetedService.id_service]);
        const targets: {id_channel: string}[] = await bdd.get("ChannelPartnerService",
                                                                ["ChannelPartner.id_channel"],
                                                                {Service: "ChannelPartnerService.id_service = Service.id_service",
                                                                    ChannelPartner: "ChannelPartnerService.id_channel = ChannelPartner.id_channel"},
                                                                {query: `Service.name = ? AND (${targetedRegions.query} OR ChannelPartner.region = 0)`,
                                                                    values: [targetedService.name]}) as {id_channel: string}[];
        nbPartner += await sendServiceMessage(client, targets, message, embed, bdd, ranks);
        if (nbPartner > 0) {
            await manageServiceSuccess(client, bdd, message, targetedRegions.requestedRegions, nbPartner, targetedService.name);
        } else if (targetedService) {
            answerTmp(client,
                message,
                "Your message was not delivered to any channel. " +
                "This may be because no users have activated the region filter you specified.",
                30000);
        }
        await manageMsgExpiration(client);
        return true
    } catch (err) {
        console.error(err);
        await sendLog(client, "manageDistribution error : \n" + (err as TypeError).message);
        return false;
    }
}

export {manageDistribution};