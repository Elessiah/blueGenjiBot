import { PermissionFlagsBits, type Client } from "discord.js";
import { truncateMessage } from "./notifications.js";

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
}

/**
 * Le salon d'annonce est introuvable, ou le bot ne peut pas y écrire : rien
 * n'est parti. La route en fait un `503`, et le site rend sa réservation pour
 * réessayer au balayage suivant.
 */
export class LiveChannelUnavailableError extends Error {
  constructor(reason: string) {
    super(`LIVE_CHANNEL_UNAVAILABLE: ${reason}`);
    this.name = "LiveChannelUnavailableError";
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
  return { message: truncateMessage(message), streamUrl, context };
}

/**
 * Texte publié : la mention, le message de l'app, puis le lien seul sur sa
 * ligne (Discord en tire l'aperçu de la chaîne).
 *
 * @param request Demande validée.
 * @returns Le contenu du message Discord.
 */
export function formatLiveAnnouncement(request: LiveAnnouncementRequest): string {
  return `@everyone ${request.message}\n${request.streamUrl}`;
}

type SendableChannel = {
  send: (options: { content: string; allowedMentions: { parse: ["everyone"] } }) => Promise<{ id: string }>;
  permissionsFor?: (user: unknown) => { has: (flag: bigint) => boolean } | null;
};

/**
 * Lit les permissions du bot dans le salon. Un salon qui ne les expose pas (ou
 * un client sans utilisateur) est tenu pour accessible : l'envoi dira le reste.
 */
function readPermissions(client: Client, channel: SendableChannel): { canSend: boolean; canMentionEveryone: boolean } {
  const permissions = client.user && channel.permissionsFor ? channel.permissionsFor(client.user) : null;
  if (!permissions) { return { canSend: true, canMentionEveryone: true }; }
  return {
    canSend: permissions.has(PermissionFlagsBits.ViewChannel) && permissions.has(PermissionFlagsBits.SendMessages),
    canMentionEveryone: permissions.has(PermissionFlagsBits.MentionEveryone),
  };
}

/**
 * Publie l'annonce dans le salon #live.
 *
 * Sans la permission « Mentionner @everyone », le message part quand même —
 * une annonce sans notification vaut mieux que pas d'annonce — et le bilan le
 * dit (`mentionEveryone: false`) pour que la route le journalise.
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
    throw new LiveChannelUnavailableError("salon illisible");
  }
  if (!channel || typeof channel.send !== "function") {
    throw new LiveChannelUnavailableError("salon introuvable ou non textuel");
  }

  const { canSend, canMentionEveryone } = readPermissions(client, channel);
  if (!canSend) { throw new LiveChannelUnavailableError("permission d'écrire absente"); }

  try {
    // `parse: ["everyone"]` et rien d'autre : seule la mention de tête notifie.
    await channel.send({ content: formatLiveAnnouncement(request), allowedMentions: { parse: ["everyone"] } });
  } catch (error) {
    throw new LiveChannelUnavailableError(`envoi refusé (${(error as Error).message})`);
  }
  return { posted: true, mentionEveryone: canMentionEveryone };
}
