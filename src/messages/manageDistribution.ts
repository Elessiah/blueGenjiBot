import {sendLog} from "../safe/sendLog.js";
import {describeError} from "../safe/errorGuards.js";
import {manageMsgExpiration} from "./manageMsgExpiration.js";
import {checkMessageValidity, type BanCheckMemo} from "./checkMessageValidity.js";
import {getTargetRegions} from "./getTargetRegions.js";
import {buildServiceMessage} from "./buildServiceMessage.js";
import {sendServiceMessage} from "./sendServiceMessage.js";
import {manageServiceSuccess} from "./manageServiceSuccess.js";
import {extractRanks} from "../utils/extractRanks.js";
import {answerTmp} from "../utils/answerTmp.js";
import {servicesWithNoRanks} from "../utils/servicesWithNoRanks.js";
import {getServicesAndID} from "../utils/getServiceAndID.js";
import {safeMsgReply} from "../safe/safeMsgReply.js";
import {safeReact} from "../safe/safeReact.js";
import {recordEvent} from "@/feed/feedBus.js";
import {isModuleEnabled} from "@/modules/moduleGuard.js";
import type {Attachment, Client, EmbedBuilder, Message} from "discord.js";
import type {Bdd} from "../bdd/Bdd.js";
import type {Service} from "../bdd/types.js";

/** Régions visées par une annonce : le filtre SQL et les régions annoncées à l'auteur. */
type TargetedRegions = {query: string, requestedRegions: number[]};

/** L'annonce vise plusieurs services : refusée (l'auteur a déjà été prévenu). */
const SEVERAL_SERVICES = Symbol("several-services");

/** Le message porte plus d'une pièce jointe : refusé (l'auteur a déjà été prévenu). */
const TOO_MANY_ATTACHMENTS = Symbol("too-many-attachments");

const NO_REGION_NOTICE = "Note that your message will only be delivered to channels without filters.\n" +
    "To target your ad more precisely, specify a region. Available regions: `EU, NA, LATAM, ASIA.`";

const SEVERAL_SERVICES_NOTICE = "Your message has not been sent ! \n" +
    "# Sending to multiple services is strictly prohibited.\n" +
    "If necessary, split your request and send it in parts. **Spamming may result in a bot ban.**";

const NO_KEYWORD_NOTICE = "Your message has no keyword for a targeted service. Please, next time, use these keywords:\n" +
    " - `lfs`: If you are looking for a scrim.\n" +
    " - `lfp`: If you are looking for **players for your team to play tournaments and scrims**.\n" +
    " - `lfg`: If you are looking for **players to play ranked, quickplay, or chill with**.\n" +
    " - `lft`: If you are looking for **a team to play tournaments and scrims**.\n" +
    " - `lfsub`: If you are looking for a last-minute player for tournaments or scrims.\n" +
    " - `ta`: If you want to promote your tournament.\n" +
    " - `lfstaff`: If you are looking for staff for a team or organization, like a coach or admin.\n" +
    " - `lfcast`: If you are looking for casters to animate your tournament.\n";

const NOT_DELIVERED_NOTICE = "Your message was not delivered to any channel. " +
    "This may be because no users have activated the region filter you specified.";

/**
 * Orchestre la distribution d'un service vers tous les salons cibles.
 * @param message Message source à distribuer vers le réseau de partenaires.
 * @param client Client Discord utilisé pour les appels API.
 * @param bdd Instance de base de données.
 * @param channelId Identifiant du salon d'origine du message.
 * @param channelServices Services actuellement configurés sur le salon source.
 * @returns `true` quand le flux de distribution termine (même si 0 diffusion), `false` en cas d'entrée invalide, multi-service, service absent ou erreur bloquante.
 */
async function manageDistribution(message: Message,
                                  client: Client,
                                  bdd: Bdd,
                                  channelId: string,
                                  channelServices: {name: string; id_service: number}[]): Promise<boolean> {
    try {
        const attachment = pickAttachment(client, message);
        if (attachment === TOO_MANY_ATTACHMENTS) {
            return false;
        }
        const services: Service[] = await getServicesAndID();
        const silence: boolean = await servicesWithNoRanks(channelServices);
        const ranks: string[] = await extractRanks(client, message, silence);
        const embed: EmbedBuilder = await buildServiceMessage(client, message, channelId, attachment);
        const messageContentLower: string = message.content.toLowerCase();
        const targetedRegions = await resolveTargetRegions(client, bdd, message, channelId, messageContentLower);
        if (message.guildId && !await isModuleEnabled(message.guildId, 'annonces')) {
            await answerTmp(client, message, 'Le module Annonces est desactive sur ce serveur.', 10000);
            return false;
        }
        const targetedService = await selectTargetedService(client, message, services, messageContentLower);
        if (targetedService === SEVERAL_SERVICES) {
            return false;
        }
        if (!targetedService) {
            await answerTmp(client, message, NO_KEYWORD_NOTICE, 120000);
            return false;
        }
        await bdd.set('MessageService', ['id_msg', 'id_service'], [message.id, targetedService.id_service]);
        const targets = await findTargetChannels(bdd, targetedService, targetedRegions);
        const nbPartner = await sendServiceMessage(client, targets, message, embed, bdd, ranks);
        await reportDistribution(client, bdd, message, targetedService, targetedRegions, nbPartner);
        await manageMsgExpiration(client);
        return true
    } catch (err) {
        await logDistributionError(client, err);
        return false;
    }
}

/**
 * Pièce jointe à relayer : une seule est permise.
 * @returns La pièce jointe, `undefined` sans pièce jointe, `TOO_MANY_ATTACHMENTS` au-delà d'une.
 */
function pickAttachment(client: Client, message: Message): Attachment | undefined | typeof TOO_MANY_ATTACHMENTS {
    if (message.attachments.size > 1) {
        // Fonction synchrone : la réponse part sans être attendue, mais un échec est journalisé.
        answerTmp(client,
            message,
            "You cannot send more than one attachment ! Cancel your Distribution.",
            30000).catch((error: unknown) => console.error("Réponse temporaire impossible :", describeError(error)));
        return TOO_MANY_ATTACHMENTS;
    }
    if (message.attachments.size === 1) {
        const attachement: IteratorResult<Attachment | undefined> = message.attachments.values().next();
        return attachement.value.attachment;
    }
    return undefined;
}

/**
 * Régions visées : celles que l'annonce nomme, sinon celle du salon d'origine.
 * Un salon d'origine sans région ne vise que les salons sans région, et
 * l'auteur en est prévenu.
 */
async function resolveTargetRegions(client: Client,
                                    bdd: Bdd,
                                    message: Message,
                                    channelId: string,
                                    messageContentLower: string): Promise<TargetedRegions> {
    const partnerRegions: {region: number}[] = await bdd.get("ChannelPartner", ["region"], {}, {query: "id_channel = ?", values: [channelId]}) as {region: number}[];
    const currentRegion: number = partnerRegions.length > 0 ? partnerRegions[0].region : 0;
    const targetedRegions = await getTargetRegions(currentRegion, messageContentLower);
    if (targetedRegions !== null) {
        return targetedRegions;
    }
    // Non attendue : l'avis à l'auteur ne doit pas retarder le relais.
    answerTmp(client, message, NO_REGION_NOTICE, 30000)
        .catch((error: unknown) => console.error("Réponse temporaire impossible :", describeError(error)));
    return {query: "ChannelPartner.region = 0", requestedRegions: [0]};
}

/**
 * Service visé par l'annonce : un seul est permis. Chaque service est vérifié
 * (mot-clé, exclusion, délai) ; l'exclusion n'est lue qu'une fois par message.
 * @returns Le service, `null` si aucun n'est valablement visé, `SEVERAL_SERVICES` si plusieurs le sont.
 */
async function selectTargetedService(client: Client,
                                     message: Message,
                                     services: Service[],
                                     messageContentLower: string): Promise<Service | null | typeof SEVERAL_SERVICES> {
    const hasValidService: {value: boolean} = {value: false};
    const banCheck: BanCheckMemo = {verdict: null};
    let targetedService: Service | null = null;
    for (const service of services) {
        if (!await checkMessageValidity(client, service, messageContentLower, message, hasValidService, banCheck)) {
            continue;
        }
        if (targetedService) {
            await safeMsgReply(client, message, SEVERAL_SERVICES_NOTICE);
            await safeReact(client, message, '🚫');
            return SEVERAL_SERVICES;
        }
        targetedService = service;
    }
    return targetedService;
}

/** Salons partenaires du service, dans les régions visées ou sans région. */
async function findTargetChannels(bdd: Bdd, service: Service, regions: TargetedRegions): Promise<{id_channel: string}[]> {
    return await bdd.get("ChannelPartnerService",
        ["ChannelPartner.id_channel"],
        {Service: "ChannelPartnerService.id_service = Service.id_service",
            ChannelPartner: "ChannelPartnerService.id_channel = ChannelPartner.id_channel"},
        {query: `Service.name = ? AND (${regions.query} OR ChannelPartner.region = 0)`,
            values: [service.name]}) as {id_channel: string}[];
}

/** Bilan à l'auteur : succès (et fil d'activité), ou aucun salon servi. */
async function reportDistribution(client: Client,
                                  bdd: Bdd,
                                  message: Message,
                                  service: Service,
                                  regions: TargetedRegions,
                                  nbPartner: number): Promise<void> {
    if (nbPartner > 0) {
        await manageServiceSuccess(client, bdd, message, regions.requestedRegions, nbPartner, service.name);
        await recordEvent(client, 'relay', `${service.name} vers ${nbPartner} salon(s)`, message.guild?.name ?? null, null);
    } else {
        await answerTmp(client, message, NOT_DELIVERED_NOTICE, 30000);
    }
}

/**
 * Journalise une erreur de distribution, sans jamais l'objet d'erreur entier.
 * @param client Client Discord utilisé pour le journal.
 * @param err Valeur levée.
 */
async function logDistributionError(client: Client, err: unknown): Promise<void> {
    // Le message seul : l'objet d'erreur d'une requête Discord porte
    // l'annonce (pseudo de l'auteur, texte), que les journaux ne gardent pas.
    const description = describeError(err);
    // La pile pour pm2 (elle ne porte pas l'annonce), jamais l'objet entier.
    const trace = errorTrace(description, err);
    console.error("manageDistribution error:", trace);
    await sendLog(client, "manageDistribution error : \n" + description);
}

/**
 * Trace écrite sur la console : la description (déjà filtrée), puis les
 * seules lignes d'appel de la pile — sa première ligne recopie le message,
 * quel qu'il soit.
 * @param description Description filtrée de l'erreur.
 * @param err Valeur levée.
 * @returns La description, suivie des lignes d'appel quand la pile est lisible.
 */
function errorTrace(description: string, err: unknown): string {
    try {
        if (err instanceof Error && typeof err.stack === "string" && err.stack) {
            return [description, ...err.stack.split("\n").filter((line) => /^\s+at\s/.test(line))].join("\n");
        }
    } catch { /* valeur illisible : la description suffit */ }
    return description;
}

export {manageDistribution};
