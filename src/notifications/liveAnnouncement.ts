import { createHash } from "node:crypto";
import { PermissionFlagsBits, type Client } from "discord.js";

/**
 * Annonce d'un live dans le salon #live du serveur BlueGenji, poussée par l'app
 * web au début d'un match diffusé (`POST /internal/announce/live`).
 *
 * L'app décide **quand** annoncer (elle seule connaît le match, son état de
 * diffusion et ce qui a déjà été annoncé) et rédige le texte, noms d'équipe
 * déjà neutralisés ; le bot valide, préfixe la mention `@everyone` et publie.
 * C'est le **seul** message du bot qui notifie tout le serveur : la mention
 * n'est autorisée (`allowedMentions`) que pour cet envoi-là.
 */

/**
 * Salon #live du serveur BlueGenji esport. Un identifiant de salon public, pas
 * un secret — gardé ici, en un seul endroit, plutôt que dans la configuration
 * du serveur : le salon d'annonce n'est pas un réglage par serveur.
 */
export const LIVE_ANNOUNCE_CHANNEL_ID = "678961388030394401";

/** Plateformes de diffusion acceptées — la même liste blanche que le site. */
const LIVE_HOSTS = new Set([
  "twitch.tv", "www.twitch.tv", "m.twitch.tv",
  "youtube.com", "www.youtube.com", "m.youtube.com",
  "youtu.be", "www.youtu.be", "m.youtu.be",
  "kick.com", "www.kick.com", "m.kick.com",
]);

/** Longueur maximale d'un lien de diffusion (celle du site). */
const MAX_STREAM_URL_LENGTH = 255;

/** Plafond Discord d'un message, mention et lien compris. */
const DISCORD_MAX_CONTENT_LENGTH = 2000;

/**
 * Longueur maximale du texte reçu de l'app. Au-delà, il est coupé d'un simple
 * « … » : jamais la mention « (message tronqué) » des messages privés, qui
 * n'a rien à faire dans une annonce publique.
 */
export const MAX_LIVE_MESSAGE_LENGTH = 1800;

/** Longueur maximale de l'étiquette `context` (journaux pm2 et canal de logs). */
export const MAX_LIVE_CONTEXT_LENGTH = 200;

/** Longueur maximale du texte d'erreur brut cité dans un signalement. */
export const MAX_LIVE_DETAIL_LENGTH = 300;

/**
 * Plafond d'un signalement au canal de logs : sous les 2 000 caractères d'un
 * message Discord, sans quoi il serait refusé — et perdu.
 */
export const MAX_LIVE_LOG_LENGTH = 1900;

/** Mention de tête, posée seulement quand le bot peut notifier tout le serveur. */
const EVERYONE_PREFIX = "@everyone ";

/** Codes Discord d'un accès refusé : permission manquante, salon invisible. */
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;
/** Code Discord d'un salon inconnu (supprimé, identifiant périmé). */
const UNKNOWN_CHANNEL = 10003;
/**
 * Attente de mode lent en deçà de laquelle un refus n'est pas signalé au
 * staff : le site réessaie toutes les dix secondes environ, l'annonce partira
 * d'elle-même.
 */
export const SLOWMODE_SILENT_MS = 60 * 1000;

/** « 45 s », « 12 min », « 5 h 59 min » : une attente lisible par le staff. */
export function formatWait(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) { return `${seconds} s`; }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) { return `${minutes} min`; }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Codes Discord d'un message bloqué par une règle AutoMod du serveur. */
const AUTOMOD_BLOCKED = new Set([200000, 200001]);

/** Code d'erreur Discord porté par une `DiscordAPIError`, sinon `undefined`. */
function discordCode(error: unknown): number | undefined {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "number" ? code : undefined;
}

/**
 * Échec d'un `channel.send`, classé : un refus explicite de Discord (erreur
 * d'API portant un code) dit que rien n'est parti — faute de permission
 * (`send-denied`), par AutoMod (`automod`) ou pour une autre raison
 * (`send-rejected`) ; sans code, c'est une panne pendant l'envoi (`discord-down`, réseau,
 * `5xx`, limite de débit) qui a pu cacher une publication réussie.
 *
 * @param error Erreur levée par l'envoi.
 * @returns L'erreur à lever.
 */
function sendFailure(error: unknown): LiveChannelUnavailableError {
  const detail = (error as Error).message;
  const code = discordCode(error);
  if (code === UNKNOWN_CHANNEL) {
    // Salon supprimé ou recréé alors que le cache le gardait.
    return new LiveChannelUnavailableError("missing", `salon introuvable à l'envoi (${detail})`, detail);
  }
  if (code === MISSING_ACCESS || code === MISSING_PERMISSIONS) {
    return new LiveChannelUnavailableError("send-denied", `envoi refusé faute de permission (${detail})`, detail);
  }
  if (code !== undefined && AUTOMOD_BLOCKED.has(code)) {
    return new LiveChannelUnavailableError("automod", `envoi bloqué par AutoMod (${detail})`, detail);
  }
  if (code !== undefined && code > 0) {
    return new LiveChannelUnavailableError("send-rejected", `envoi refusé par Discord (${detail})`, detail);
  }
  return new LiveChannelUnavailableError("discord-down", `envoi sans réponse claire de Discord (${detail})`, detail);
}

/**
 * Coupe un texte à `max` unités au plus, terminé par « … », sans jamais
 * couper un caractère en deux (émoji, lettre hors du plan de base) : un « � »
 * sous `@everyone` aurait l'air d'une panne.
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) { return text; }
  let end = max - 1;
  const last = text.charCodeAt(end - 1);
  // Moitié haute d'une paire de substitution laissée seule : on la retire.
  if (last >= 0xd800 && last <= 0xdbff) { end -= 1; }
  return `${text.slice(0, end)}…`;
}

/**
 * Neutralise une mention de masse glissée dans le texte : seule la mention de
 * tête, posée par le bot, doit notifier (`allowedMentions` autorise
 * `everyone`, qui couvre aussi `@here`). Le site neutralise déjà les noms ;
 * c'est la seconde barrière.
 */
function neutralizeMassMentions(text: string): string {
  return text.replace(/@(everyone|here)/gi, "@\u200B$1");
}

/**
 * Jeton d'unicité de l'envoi (`nonce`, 25 caractères au plus), tiré de
 * l'étiquette et du lien : Discord ne crée pas deux messages de même jeton à
 * quelques minutes d'écart — le même envoi rejoué peu après (réponse perdue,
 * nouvel essai du site) ne notifie pas deux fois tout le serveur. Il réduit
 * le risque sans l'écarter : un essai plus tardif, ou regroupé avec un autre
 * match (autre étiquette), n'est pas reconnu.
 */
export function liveAnnouncementNonce(request: LiveAnnouncementRequest): string {
  const seed = `${request.context}\n${request.streamUrl}`;
  return "live" + createHash("sha256").update(seed).digest("hex").slice(0, 21);
}

/**
 * Délai entre deux signalements d'un même incident au canal de logs. Le site
 * réessaie une annonce refusée à chaque balayage (toutes les dix secondes au
 * plus, tant que le match est frais) : sans ce délai, une permission retirée
 * sur #live inonderait le canal du staff.
 */
export const LIVE_LOG_COOLDOWN_MS = 60 * 60 * 1000;

const lastLiveLogAt = new Map<string, number>();

/**
 * Vrai si l'incident `key` peut être signalé au canal de logs maintenant : la
 * première fois, puis au plus une fois par {@link LIVE_LOG_COOLDOWN_MS}.
 *
 * @param key Nature de l'incident (raison du refus, permission manquante).
 * @param now Instant de référence, injectable pour les tests.
 * @returns `true` si le signalement doit partir.
 */
export function shouldLogLiveIssue(key: string, now: number = Date.now()): boolean {
  const last = lastLiveLogAt.get(key);
  if (last !== undefined && now - last < LIVE_LOG_COOLDOWN_MS) { return false; }
  lastLiveLogAt.set(key, now);
  return true;
}

/**
 * Oublie un signalement qui n'a pas pu partir (canal de logs injoignable) :
 * le prochain incident de même nature sera signalé, au lieu d'un silence d'une
 * heure.
 *
 * @param key Nature de l'incident.
 */
export function forgetLiveIssue(key: string): void {
  lastLiveLogAt.delete(key);
}

/** Oublie les signalements déjà faits. Réservé aux tests. */
export function resetLiveLogThrottle(): void {
  lastLiveLogAt.clear();
  lastLivePostAt = null;
}

/**
 * Instant de la dernière annonce publiée par ce processus (mémoire seule : au
 * redémarrage, inconnu). Le mode lent ne retient un envoi que si le bot a déjà
 * posté dans le salon pendant le délai.
 */
let lastLivePostAt: number | null = null;

/**
 * Ce que le staff doit faire, selon la nature de l'incident
 * ({@link LiveChannelUnavailableError.key}) : la phrase du canal de logs.
 *
 * @param key Nature de l'incident : `missing` (salon introuvable ou invisible),
 *   `no-view`, `no-send` (permission manquante), `send-denied` (envoi refusé
 *   faute de permission), `slowmode` (mode lent qui retiendrait l'envoi),
 *   `automod` (message bloqué par AutoMod), `send-rejected` (autre refus
 *   explicite de Discord), `discord-unreachable` (panne passagère de Discord
 *   avant l'envoi : rien n'est parti), `discord-down` (panne pendant l'envoi :
 *   l'annonce a pu partir), autre.
 * @param rawDetail Texte d'erreur brut de Discord, cité pour le diagnostic,
 *   coupé à {@link MAX_LIVE_DETAIL_LENGTH} caractères.
 * @returns Une phrase en français, avec l'action à mener.
 */
export function describeLiveIssue(key: string, rawDetail: string): string {
  // Le texte d'erreur brut est cité, borné : le signalement doit tenir dans un message.
  const detail = cutText(rawDetail, MAX_LIVE_DETAIL_LENGTH);
  switch (key) {
    case "missing":
      return "le salon #live est introuvable ou invisible pour le bot — vérifier qu'il existe et que le bot a la permission « Voir le salon » ; " +
        "s'il a été supprimé puis recréé, son nouvel identifiant doit être reporté dans le code du bot (LIVE_ANNOUNCE_CHANNEL_ID)";
    case "slowmode":
      return `le mode lent de #live retient l'annonce (${detail} ; le bot y a déjà posté pendant le délai) — passé deux heures après le début du direct, elle ne partira plus : si l'attente est longue, raccourcir le mode lent ou donner au bot la permission « Gérer les messages » dans #live`;
    case "no-view":
      return "le bot n'a pas la permission « Voir le salon » dans #live — la lui rendre";
    case "no-send":
      return "le bot n'a pas la permission « Envoyer des messages » dans #live — la lui rendre";
    case "send-denied":
      return `Discord a refusé l'envoi faute de permission (${detail}) — vérifier les permissions du bot dans #live`;
    case "automod":
      return `une règle AutoMod du serveur a bloqué l'annonce (${detail}) — la revoir dans Paramètres du serveur → AutoMod`;
    case "send-rejected":
      return `Discord a refusé l'annonce (${detail}) — vérifier le salon #live et les permissions du bot`;
    case "discord-unreachable":
      return `Discord n'a pas répondu ou a limité le bot en lisant le salon (${detail}) — rien n'est parti, rien à régler sur le salon`;
    case "discord-down":
      return `Discord n'a pas répondu ou a limité le bot pendant l'envoi (${detail}) — rien à régler sur le salon ; ` +
        "l'annonce a pu partir malgré tout : si elle est déjà dans #live, un nouvel essai du site peut la doubler, supprimer alors le doublon";
    default:
      return `erreur inattendue (${detail})`;
  }
}

/** Préfixe que `sendLog` ajoute devant chaque signalement de l'app. */
const LOG_PREFIX = "[AppBlueGenji] ";

/**
 * Verdict d'un échec : « non confirmée » quand une panne pendant l'envoi a pu
 * cacher une publication réussie, « non publiée » sinon.
 *
 * @param key Nature de l'incident ({@link describeLiveIssue}).
 * @returns Le verdict, commun au canal de logs et à pm2.
 */
export function liveFailureVerdict(key: string): string {
  return key === "discord-down" ? "non confirmée" : "non publiée";
}

/**
 * Signalement au canal de logs d'une annonce qui n'est pas partie, sans le
 * préfixe `[AppBlueGenji]` : la cause et l'action à mener, puis l'annonce
 * concernée (équipes et tournoi, jamais un pseudo) et son lien, cités pour la
 * reconnaître — le site la réessaie seul, la reposter à la main pendant ce
 * temps notifierait deux fois tout le serveur. Une panne passagère de Discord
 * peut cacher un envoi réussi : elle est dite « non confirmée », pas « non
 * publiée ». Le tout tient sous {@link MAX_LIVE_LOG_LENGTH} caractères,
 * préfixe compris : la citation est raccourcie au besoin, le lien reste entier.
 *
 * @param request Demande validée.
 * @param key Nature de l'incident ({@link describeLiveIssue}).
 * @param detail Texte d'erreur brut de Discord.
 * @returns Le texte du signalement.
 */
export function liveFailureReport(request: LiveAnnouncementRequest, key: string, detail: string): string {
  const verdict = liveFailureVerdict(key);
  const head =
    `Annonce de live ${verdict} (${request.context}) : ${describeLiveIssue(key, detail)}. ` +
    "Le site la réessaie seul pendant les deux heures qui suivent le début du direct : ne pas la " +
    "reposter à la main avant. Signalé au plus une fois par heure, d'autres annonces peuvent échouer " +
    "pour la même raison. Annonce concernée :";
  const link = `\n<${request.streamUrl}>`;
  // Place restante pour la citation : chaque ligne y gagne « > » (deux caractères).
  const room = MAX_LIVE_LOG_LENGTH - LOG_PREFIX.length - head.length - link.length - 1;
  const lineCount = request.message.split("\n").length;
  const text = room > 2 * lineCount + 1 ? cutText(request.message, room - 2 * lineCount) : "";
  const quoted = text ? "\n" + text.split("\n").map((line) => "> " + line).join("\n") : "";
  return `${head}${quoted}${link}`;
}

/** Corps normalisé de `POST /internal/announce/live`. */
export interface LiveAnnouncementRequest {
  /** Texte rédigé par l'app (équipes, tournoi), sans la mention ni le lien. */
  message: string;
  /** Lien de la diffusion, en `https` sur une plateforme de la liste blanche. */
  streamUrl: string;
  /** Étiquette de journalisation (`live-announce match-42`, …). */
  context: string;
}

/** Bilan d'une annonce publiée. */
export interface LiveAnnouncementReport {
  posted: true;
  /** `false` : le bot n'a pas la permission de mentionner tout le monde dans le salon. */
  mentionEveryone: boolean;
  /** `false` : le bot n'a pas la permission d'intégrer des liens (pas d'aperçu de la chaîne). */
  embedLinks: boolean;
}

/**
 * L'annonce n'a pas été publiée : salon introuvable, permission manquante,
 * mode lent, refus explicite de Discord (AutoMod…), ou panne passagère de Discord ({@link LiveChannelUnavailableError.key}). La
 * route en fait un `503`, et le site rend sa réservation pour réessayer au
 * balayage suivant ; si une réponse perdue cachait un envoi réussi, le jeton
 * d'unicité ({@link liveAnnouncementNonce}) écarte le doublon d'un même envoi
 * rejoué dans les quelques minutes.
 */
export class LiveChannelUnavailableError extends Error {
  /**
   * Nature stable de l'incident (sans le texte d'erreur de Discord), clé de
   * l'étranglement des signalements au staff.
   */
  readonly key: string;

  /** Texte d'erreur brut (Discord), cité dans le signalement. */
  readonly detail: string;

  constructor(key: string, reason: string, detail: string = reason) {
    super(`LIVE_CHANNEL_UNAVAILABLE: ${reason}`);
    this.name = "LiveChannelUnavailableError";
    this.key = key;
    this.detail = detail;
  }
}

/**
 * Vrai si le lien est une diffusion acceptable : `https`, hôte de la liste
 * blanche, sans identifiants ni port, 255 caractères au plus. Seconde barrière
 * — le site valide déjà —, parce que ce lien part devant tout le serveur.
 *
 * @param value Lien reçu.
 * @returns `true` si le lien peut être publié.
 */
export function isAllowedStreamUrl(value: string): boolean {
  if (value.length > MAX_STREAM_URL_LENGTH) { return false; }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return url.protocol === "https:"
    && url.username === ""
    && url.password === ""
    && url.port === ""
    && LIVE_HOSTS.has(url.hostname.toLowerCase());
}

/**
 * Valide le corps d'une annonce de live.
 *
 * @param payload Corps JSON brut.
 * @returns La demande normalisée, ou `null` si elle est inexploitable.
 */
export function parseLiveAnnouncement(payload: unknown): LiveAnnouncementRequest | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) { return null; }
  const raw = payload as Record<string, unknown>;
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  const streamUrl = typeof raw.streamUrl === "string" ? raw.streamUrl.trim() : "";
  if (!message || !isAllowedStreamUrl(streamUrl)) { return null; }
  // Assez long pour la liste des matchs d'un groupe (`live-announce match-12,13,…`).
  // Coupée d'un « … » visible : un identifiant tronqué ne passe pas pour un autre.
  const context = typeof raw.context === "string" && raw.context.trim() ? cutText(raw.context.trim(), MAX_LIVE_CONTEXT_LENGTH) : "live-announce";
  return { message: cutText(neutralizeMassMentions(message), MAX_LIVE_MESSAGE_LENGTH), streamUrl, context };
}

/**
 * Texte publié : la mention, le message de l'app, puis le lien seul sur sa
 * ligne (Discord en tire l'aperçu de la chaîne). Sans la permission de
 * mentionner, la mention n'est pas écrite : un « @everyone » gris qui ne
 * notifie personne aurait l'air d'une panne. Le message est raccourci pour que
 * l'ensemble tienne dans les 2 000 caractères d'un message Discord.
 *
 * @param request Demande validée.
 * @param mentionEveryone `false` : le bot ne peut pas notifier tout le serveur.
 * @returns Le contenu du message Discord.
 */
export function formatLiveAnnouncement(request: LiveAnnouncementRequest, mentionEveryone = true): string {
  const prefix = mentionEveryone ? EVERYONE_PREFIX : "";
  const budget = DISCORD_MAX_CONTENT_LENGTH - prefix.length - 1 - request.streamUrl.length;
  return `${prefix}${cutText(request.message, budget)}\n${request.streamUrl}`;
}

type AllowedMentions = { parse: "everyone"[] };

type SendableChannel = {
  send: (options: {
    content: string;
    allowedMentions: AllowedMentions;
    nonce: string;
    enforceNonce: boolean;
  }) => Promise<{ id: string }>;
  permissionsFor?: (user: unknown) => { has: (flag: bigint) => boolean } | null;
  /** Mode lent du salon, en secondes (0 : désactivé). */
  rateLimitPerUser?: number | null;
};

/**
 * Lit les permissions du bot dans le salon. Un salon qui ne les expose pas (ou
 * un client sans utilisateur) est tenu pour accessible : l'envoi dira le reste.
 */
function readPermissions(
  client: Client,
  channel: SendableChannel,
): { canView: boolean; canSend: boolean; canMentionEveryone: boolean; canEmbedLinks: boolean; slowWaitMs: number } {
  const permissions = client.user && channel.permissionsFor ? channel.permissionsFor(client.user) : null;
  if (!permissions) { return { canView: true, canSend: true, canMentionEveryone: true, canEmbedLinks: true, slowWaitMs: 0 }; }
  // Le mode lent retient un envoi fait moins de `rateLimitPerUser` secondes
  // après le précédent du bot (discord.js attend la fin du délai, jusqu'à six
  // heures), sauf pour qui gère les messages ou le salon : l'annonce partirait
  // bien après le début du match.
  const bypassesSlowmode =
    permissions.has(PermissionFlagsBits.ManageMessages) || permissions.has(PermissionFlagsBits.ManageChannels);
  const delayMs = (channel.rateLimitPerUser ?? 0) * 1000;
  const waitMs = delayMs > 0 && lastLivePostAt !== null ? delayMs - (Date.now() - lastLivePostAt) : 0;
  return {
    slowWaitMs: bypassesSlowmode ? 0 : Math.max(0, waitMs),
    canView: permissions.has(PermissionFlagsBits.ViewChannel),
    canSend: permissions.has(PermissionFlagsBits.SendMessages),
    canMentionEveryone: permissions.has(PermissionFlagsBits.MentionEveryone),
    canEmbedLinks: permissions.has(PermissionFlagsBits.EmbedLinks),
  };
}

/**
 * Publie l'annonce dans le salon #live.
 *
 * Sans la permission « Mentionner @everyone, @here et tous les rôles », le
 * message part quand même, sans la mention — une annonce sans notification
 * vaut mieux que pas d'annonce — et le bilan le dit (`mentionEveryone: false`)
 * pour que la route le journalise ; de même sans « Intégrer des liens »
 * (`embedLinks: false`, pas d'aperçu de la chaîne).
 *
 * @param client Client Discord.
 * @param request Demande validée.
 * @returns Le bilan de la publication.
 * @throws {LiveChannelUnavailableError} Salon introuvable ou fermé au bot.
 */
export async function announceLive(client: Client, request: LiveAnnouncementRequest): Promise<LiveAnnouncementReport> {
  let channel: SendableChannel | null;
  try {
    channel = await client.channels.fetch(LIVE_ANNOUNCE_CHANNEL_ID) as unknown as SendableChannel | null;
  } catch (error) {
    const detail = (error as Error).message;
    // Seuls un salon inconnu ou un accès refusé désignent le salon ; le reste
    // est une panne passagère de Discord (réseau, 5xx, limite de débit).
    const code = discordCode(error);
    // Rien n'est encore envoyé : une panne ici ne cache aucune publication.
    const key = code === UNKNOWN_CHANNEL || code === MISSING_ACCESS ? "missing" : "discord-unreachable";
    throw new LiveChannelUnavailableError(key, `salon illisible (${detail})`, detail);
  }
  if (!channel || typeof channel.send !== "function") {
    throw new LiveChannelUnavailableError("missing", "salon introuvable ou non textuel");
  }

  const { canView, canSend, canMentionEveryone, canEmbedLinks, slowWaitMs } = readPermissions(client, channel);
  if (!canView) { throw new LiveChannelUnavailableError("no-view", "permission de voir le salon absente"); }
  if (!canSend) { throw new LiveChannelUnavailableError("no-send", "permission d'écrire absente"); }
  if (slowWaitMs > 0) {
    // Une courte attente se règle seule au nouvel essai du site : pas de quoi
    // alerter le staff (`slowmode-short`, jamais signalé).
    const key = slowWaitMs <= SLOWMODE_SILENT_MS ? "slowmode-short" : "slowmode";
    const wait = `encore ${formatWait(slowWaitMs)}`;
    throw new LiveChannelUnavailableError(key, `mode lent actif sur le salon (${wait})`, wait);
  }

  try {
    // `parse: ["everyone"]` et rien d'autre ; toute mention de masse du texte
    // est neutralisée (`parseLiveAnnouncement`) : seule celle de tête notifie.
    // Le jeton d'unicité empêche Discord de créer deux fois la même annonce.
    await channel.send({
      content: formatLiveAnnouncement(request, canMentionEveryone),
      allowedMentions: { parse: canMentionEveryone ? ["everyone"] : [] },
      nonce: liveAnnouncementNonce(request),
      enforceNonce: true,
    });
  } catch (error) {
    throw sendFailure(error);
  }
  lastLivePostAt = Date.now();
  return { posted: true, mentionEveryone: canMentionEveryone, embedLinks: canEmbedLinks };
}
