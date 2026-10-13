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

/** Mention de tête, posée seulement quand le bot peut notifier tout le serveur. */
const EVERYONE_PREFIX = "@everyone ";

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
}

/**
 * Ce que le staff doit faire, selon la nature de l'incident
 * ({@link LiveChannelUnavailableError.key}) : la phrase du canal de logs.
 *
 * @param key Nature de l'incident (`unreadable`, `missing`, `no-send`, `send-failed`, autre).
 * @param detail Texte d'erreur brut de Discord, cité pour le diagnostic.
 * @returns Une phrase en français, avec l'action à mener.
 */
export function describeLiveIssue(key: string, detail: string): string {
  switch (key) {
    case "unreadable":
    case "missing":
      return "le salon #live est introuvable ou invisible pour le bot — vérifier qu'il existe et que le bot a la permission « Voir le salon »";
    case "no-send":
      return "le bot n'a pas les permissions « Voir le salon » et « Envoyer des messages » dans #live — les lui rendre";
    case "send-failed":
      return `Discord a refusé l'envoi (${detail}) — vérifier les permissions du bot dans #live`;
    default:
      return `erreur inattendue (${detail})`;
  }
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
 * Le salon d'annonce est introuvable, ou le bot ne peut pas y écrire : rien
 * n'est parti. La route en fait un `503`, et le site rend sa réservation pour
 * réessayer au balayage suivant.
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
  const context = typeof raw.context === "string" && raw.context.trim() ? raw.context.trim().slice(0, 80) : "live-announce";
  const capped = message.length <= MAX_LIVE_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_LIVE_MESSAGE_LENGTH - 1)}…`;
  return { message: capped, streamUrl, context };
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
  const message = request.message.length <= budget ? request.message : `${request.message.slice(0, budget - 1)}…`;
  return `${prefix}${message}\n${request.streamUrl}`;
}

type AllowedMentions = { parse: "everyone"[] };

type SendableChannel = {
  send: (options: { content: string; allowedMentions: AllowedMentions }) => Promise<{ id: string }>;
  permissionsFor?: (user: unknown) => { has: (flag: bigint) => boolean } | null;
};

/**
 * Lit les permissions du bot dans le salon. Un salon qui ne les expose pas (ou
 * un client sans utilisateur) est tenu pour accessible : l'envoi dira le reste.
 */
function readPermissions(
  client: Client,
  channel: SendableChannel,
): { canSend: boolean; canMentionEveryone: boolean; canEmbedLinks: boolean } {
  const permissions = client.user && channel.permissionsFor ? channel.permissionsFor(client.user) : null;
  if (!permissions) { return { canSend: true, canMentionEveryone: true, canEmbedLinks: true }; }
  return {
    canSend: permissions.has(PermissionFlagsBits.ViewChannel) && permissions.has(PermissionFlagsBits.SendMessages),
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
  } catch {
    throw new LiveChannelUnavailableError("unreadable", "salon illisible");
  }
  if (!channel || typeof channel.send !== "function") {
    throw new LiveChannelUnavailableError("missing", "salon introuvable ou non textuel");
  }

  const { canSend, canMentionEveryone, canEmbedLinks } = readPermissions(client, channel);
  if (!canSend) { throw new LiveChannelUnavailableError("no-send", "permission d'écrire absente"); }

  try {
    // `parse: ["everyone"]` et rien d'autre : seule la mention de tête notifie.
    await channel.send({
      content: formatLiveAnnouncement(request, canMentionEveryone),
      allowedMentions: { parse: canMentionEveryone ? ["everyone"] : [] },
    });
  } catch (error) {
    const detail = (error as Error).message;
    throw new LiveChannelUnavailableError("send-failed", `envoi refusé (${detail})`, detail);
  }
  return { posted: true, mentionEveryone: canMentionEveryone, embedLinks: canEmbedLinks };
}
