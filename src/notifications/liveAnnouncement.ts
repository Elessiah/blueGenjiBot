import { createHash } from "node:crypto";
import { PermissionFlagsBits, type Client } from "discord.js";
import { discordJsonCode } from "../safe/errorGuards.js";

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
/** Codes Discord d'un message bloqué par une règle AutoMod du serveur. */
const AUTOMOD_BLOCKED = new Set([200000, 200001]);

/**
 * Code d'erreur JSON de Discord porté par une `DiscordAPIError`, sinon
 * `undefined` : un délai dépassé (`AbortError`, code `20`) n'est pas un refus.
 */
function discordCode(error: unknown): number | undefined {
  return discordJsonCode(error) ?? undefined;
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
  if (code !== undefined) {
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
export function neutralizeMassMentions(text: string): string {
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
  // La suite d'une soirée (message plus modifiable) ne reprend pas le jeton du premier
  // envoi, ni un envoi muet (`notify: false`) celui de l'envoi qui a notifié :
  // Discord rendrait le message qui a notifié, que le site garderait muet.
  const followUp = request.editMessageId ? `\n${request.editMessageId}` : "";
  const quiet = request.notify === false ? "\nquiet" : "";
  // Ni l'une ni l'autre ne notifie : leur jeton tient aussi au texte, sans quoi
  // une suite rédigée plus tard (autre fin de match, même message à remplacer)
  // recevrait de Discord la suite précédente, à l'ancien texte, que le site
  // tiendrait pour à jour.
  const text = followUp || quiet ? `\n${request.message}` : "";
  const seed = `${request.context}\n${request.streamUrl}${followUp}${quiet}${text}`;
  return "live" + createHash("sha256").update(seed).digest("hex").slice(0, 21);
}

/**
 * Délai entre deux signalements d'un même incident au canal de logs. Le site
 * réessaie une annonce refusée environ toutes les minutes (pause du site après
 * un report), tant que le match est frais : sans ce délai, une permission retirée
 * sur #live inonderait le canal du staff.
 */
export const LIVE_LOG_COOLDOWN_MS = 60 * 60 * 1000;

const lastLiveLogAt = new Map<string, number>();

/** Taille au-delà de laquelle les signalements échus sont oubliés. */
const LIVE_LOG_PRUNE_SIZE = 200;

/**
 * Oublie les signalements dont le délai est passé : une annonce que le site
 * ne réessaie pas a sa propre clé, et le bot tourne des semaines sous pm2.
 */
function pruneLiveLogs(now: number): void {
  if (lastLiveLogAt.size < LIVE_LOG_PRUNE_SIZE) { return; }
  for (const [key, at] of lastLiveLogAt) {
    if (now - at >= LIVE_LOG_COOLDOWN_MS) { lastLiveLogAt.delete(key); }
  }
}

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
  pruneLiveLogs(now);
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
 * @param key Nature de l'incident : `missing` (salon introuvable ou invisible),
 *   `no-view`, `no-send` (permission manquante), `send-denied` (envoi refusé
 *   faute de permission), `automod` (message bloqué par AutoMod),
 *   `send-rejected` (autre refus explicite de Discord, souvent l'état du
 *   salon), `discord-unreachable` (panne passagère de Discord
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
    case "no-view":
      return "le bot n'a pas la permission « Voir le salon » dans #live — la lui rendre";
    case "no-send":
      return "le bot n'a pas la permission « Envoyer des messages » dans #live — la lui rendre";
    case "send-denied":
      return `Discord a refusé l'envoi faute de permission (${detail}) — vérifier les permissions du bot dans #live`;
    case "automod":
      return `une règle AutoMod du serveur a bloqué l'annonce (${detail}) — la revoir dans Paramètres du serveur → AutoMod`;
    case "send-rejected":
      return `Discord a refusé l'annonce (${detail}) — vérifier le salon #live (type, verrouillage) et les permissions du bot`;
    case "discord-unreachable":
      return `Discord n'a pas répondu ou a limité le bot en lisant le salon (${detail}) — rien n'est parti, rien à régler sur le salon`;
    case "discord-down":
      return `Discord n'a pas répondu ou a limité le bot pendant l'envoi (${detail}) — rien à régler sur le salon ; ` +
        "l'annonce a pu partir malgré tout (vérifier #live)";
    case "message-deleted":
      return "le message de la soirée a été supprimé de #live — aucune suite ne le republie, pour que la suppression tienne";
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

/** Le texte cité, ligne à ligne (« > »). */
function quoteLines(text: string): string {
  return text.split("\n").map((line) => "> " + line).join("\n");
}

/**
 * Causes que le site ne réessaie pas : un envoi peut-être parti (un second
 * `@everyone` serait pire qu'une annonce perdue), ou un message qu'AutoMod
 * bloquerait de nouveau tel quel (chaque essai alerterait la modération).
 */
const NOT_RETRIED_KEYS = new Set(["discord-down", "automod", "message-deleted"]);

/**
 * Vrai si le site ne réessaiera pas l'annonce après cette cause. Chacune de
 * ces annonces est signalée à part (pas de nouvel essai, donc pas de rafale).
 *
 * @param key Nature de l'incident.
 */
export function isLiveIssueFinal(key: string): boolean {
  return NOT_RETRIED_KEYS.has(key);
}

/**
 * Signalement au canal de logs d'une annonce qui n'est pas partie, sans le
 * préfixe `[AppBlueGenji]` : la cause et l'action à mener, puis l'annonce
 * concernée (équipes et tournoi, jamais un pseudo : sa version de journal,
 * {@link loggedLiveText}) et son lien, cités pour la
 * reconnaître — le site la réessaie seul, la reposter à la main pendant ce
 * temps notifierait deux fois tout le serveur. Une panne passagère de Discord
 * peut cacher un envoi réussi : elle est dite « non confirmée », pas « non
 * publiée ». Le tout tient sous {@link MAX_LIVE_LOG_LENGTH} caractères,
 * préfixe compris : la citation est raccourcie au besoin, le lien reste entier.
 *
 * @param request Demande validée.
 * @param key Nature de l'incident ({@link describeLiveIssue}).
 * @param detail Texte d'erreur brut de Discord.
 * @param options `siteGaveUp` : le site avait coupé la requête avant la
 *   réponse (délai dépassé) — il ne réessaiera pas, quelle que soit la cause.
 * @returns Le texte du signalement.
 */
export function liveFailureReport(
  request: LiveAnnouncementRequest,
  key: string,
  detail: string,
  options: { siteGaveUp?: boolean } = {},
): string {
  const siteGaveUp = options.siteGaveUp === true;
  const link = `\n<${request.streamUrl}>`;
  const intro = `Annonce de live ${liveFailureVerdict(key)} (${request.context}) : ${describeLiveIssue(key, detail)}. `;
  if (key === MESSAGE_DELETED) {
    // Message supprimé (souvent sur demande) : ni son texte ni une consigne
    // de le reposter, la suppression doit tenir. Le site ferme la soirée de
    // ce public à cette réponse — sauf s'il avait cessé de l'attendre : il le
    // fera au prochain direct, que le bot refusera de même.
    const closing = siteGaveUp
      ? "Le site avait déjà cessé d'attendre la réponse : il fermera la soirée de ce public au prochain direct, qui ne republiera rien non plus."
      : "Le site n'y publie plus rien pour ce public jusqu'à la fin de la soirée.";
    return `${intro}${closing} Ne pas la reposter à la main.`;
  }
  if (key === "automod") {
    // Citer le texte ou le lien bloqués ferait bloquer le signalement par la
    // même règle (une règle peut viser les liens de diffusion).
    return `${intro}${retrySentence(request, key, siteGaveUp, true)} Texte et lien non cités ici (la même règle pourrait les bloquer).`;
  }
  const max = MAX_LIVE_LOG_LENGTH - LOG_PREFIX.length;
  const logged = loggedLiveText(request);
  const lineCount = logged.split("\n").length;
  // La citation sert à reconnaître l'annonce, raccourcie au besoin ; si elle
  // l'est, ou si c'est la version sans pseudo (elle diffère alors du texte
  // publié), la consigne de la poster à la main renvoie à la fiche du tournoi.
  const build = (shortened: boolean): { head: string; text: string } => {
    const head = `${intro}${retrySentence(request, key, siteGaveUp, shortened)} Annonce concernée :`;
    // Place restante : chaque ligne y gagne « > » (deux caractères).
    const room = max - head.length - link.length - 1;
    const text = room > 2 * lineCount + 1 ? cutText(logged, room - 2 * lineCount) : "";
    return { head, text };
  };
  const anonymized = logged !== request.message;
  let { head, text } = build(anonymized);
  if (!anonymized && text !== logged) { ({ head, text } = build(true)); }
  const quoted = text ? "\n" + quoteLines(text) : "";
  return `${head}${quoted}${link}`;
}

/**
 * Mention d'une annonce postée à la main : **aucune** pour une annonce de
 * soirée — modification, suite ou envoi `notify: false` (un message de la
 * soirée a déjà pu notifier), ou premier message refusé (le site rend alors la
 * notification au prochain direct de la soirée : une mention à la main
 * notifierait deux fois) —, sinon celle de son public (tout le serveur, ou le
 * seul rôle StreamViewer pour une autre chaîne que la chaîne officielle).
 */
function manualMention(request: LiveAnnouncementRequest): string {
  if (request.editMessageId !== undefined || request.notify === false) {
    return "sans aucune mention (un message de cette soirée a déjà pu notifier son public)";
  }
  if (request.streamUrls !== undefined) {
    return "sans aucune mention (le prochain direct de la soirée notifiera son public)";
  }
  return audienceMention(request);
}

/** Mention du public d'une annonce, à écrire en tête d'un message posté à la main. */
function audienceMention(request: LiveAnnouncementRequest): string {
  return request.mention === "stream-viewer"
    ? "avec la mention du rôle StreamViewer en tête (pas celle de tout le serveur)"
    : "avec la mention de tout le serveur en tête";
}

/**
 * Consigne d'une annonce que le site ne réessaie pas, quand rien n'est parti
 * (toute cause sauf une panne pendant l'envoi) : elle peut être postée à la
 * main, avec la mention de son public ({@link manualMention}), et le texte
 * entier si la citation est raccourcie.
 */
function manualPostSentence(request: LiveAnnouncementRequest, key: string, shortened: boolean): string {
  if (key === "discord-down") { return ""; }
  const when = key === "automod" ? "une fois la règle corrigée, " : "";
  if (request.editMessageId !== undefined || request.notify === false) {
    // Le texte est celui de toute la soirée : le reposter doublerait les
    // matchs déjà montrés dans #live.
    return ` Rien n'est parti : ${when}seuls les matchs de l'étiquette que #live ne montre pas encore peuvent être postés à la main, ${manualMention(request)} — pas le texte entier de la soirée, dont le reste est déjà publié.`;
  }
  const whole = shortened
    ? " (texte cité raccourci, sans pseudo ou absent : reprendre toutes les affiches depuis la fiche du tournoi, /tournois/<n° de « tournoi- » dans l'étiquette>)"
    : "";
  return ` Rien n'est parti : ${when}elle peut être postée à la main sans doublon, ${manualMention(request)}${whole}.`;
}

/**
 * Consigne d'une annonce de soirée dont le site avait déjà cessé d'attendre la
 * réponse : il la croit peut-être partie — il garde la marque de notification
 * de la soirée et la reprend au message du direct suivant, sans notifier.
 * Rien n'est parti (hors panne pendant l'envoi) : un premier message peut être
 * posté à la main **avec** la mention de son public (le direct suivant ne
 * notifiera pas) ; une modification, une suite ou un envoi muet ne se postent
 * pas à la main (le direct suivant les reprend).
 */
function eveningGaveUpSentence(request: LiveAnnouncementRequest, key: string, shortened: boolean): string {
  if (key === "discord-down") { return ""; }
  if (request.editMessageId !== undefined || request.notify === false) {
    return " Rien n'est parti, mais le site la croit peut-être partie : ne pas la poster à la main, le direct suivant de la soirée la reprendra dans son message.";
  }
  const when = key === "automod" ? "une fois la règle corrigée, " : "";
  const whole = shortened
    ? " (texte cité raccourci, sans pseudo ou absent : reprendre toutes les affiches depuis la fiche du tournoi, /tournois/<n° de « tournoi- » dans l'étiquette>)"
    : "";
  return ` Rien n'est parti : ${when}elle peut être postée à la main, ${audienceMention(request)} — le site la croit peut-être partie, le direct suivant de la soirée partira sans notification${whole}.`;
}

/**
 * Consigne d'une mise à jour de la soirée (matchs terminés) qui a échoué :
 * rien à poster à la main — les matchs sont déjà dans #live, seul leur état
 * (« Terminé ») manque, et le site la refait à la fin de match ou au direct
 * suivant de la soirée.
 */
const REFRESH_SENTENCE =
  "Simple mise à jour des matchs terminés de la soirée : rien à poster à la main, " +
  "la fin de match ou le direct suivant de la soirée la refera.";

/** Ce que fera le site après cet échec, et ce que le staff peut faire. */
function retrySentence(request: LiveAnnouncementRequest, key: string, siteGaveUp: boolean, shortened: boolean): string {
  if (request.refresh === true) { return REFRESH_SENTENCE; }
  if (siteGaveUp && request.streamUrls !== undefined) {
    return "Le site avait déjà cessé d'attendre la réponse du bot : il ne la réessaie pas." +
      eveningGaveUpSentence(request, key, shortened);
  }
  if (siteGaveUp) {
    // Le site a cessé d'attendre la réponse : il garde sa réservation.
    return "Le site avait déjà cessé d'attendre la réponse du bot : il ne la réessaie pas." +
      manualPostSentence(request, key, shortened);
  }
  if (key === "discord-down") {
    return "Le site ne la réessaie pas, pour ne pas notifier deux fois tout le serveur.";
  }
  if (isLiveIssueFinal(key)) {
    return "Le site ne la réessaie pas : AutoMod bloquerait de nouveau le même message." +
      manualPostSentence(request, key, shortened);
  }
  return "Le site la réessaie seul pendant les deux heures qui suivent le début du direct : ne pas la " +
    "reposter à la main avant. Signalé au plus une fois par heure, d'autres annonces peuvent échouer " +
    "pour la même raison.";
}

/** Corps normalisé de `POST /internal/announce/live`. */
export interface LiveAnnouncementRequest {
  /** Texte rédigé par l'app (équipes, tournoi), sans la mention ni le lien. */
  message: string;
  /** Lien de la diffusion, en `https` sur une plateforme de la liste blanche. */
  streamUrl: string;
  /** Étiquette de journalisation (`live-announce match-42`, …). */
  context: string;
  /**
   * Version **sans pseudo** du texte (le pseudo d'une entrée individuelle
   * remplacé par « un joueur »), seule citée au canal de logs. Absente quand
   * le texte ne nomme aucun joueur : `message` est alors cité.
   */
  logMessage?: string;
  /**
   * Public notifié : `everyone` (chaîne officielle, défaut d'un site plus
   * ancien) ou `stream-viewer` (toute autre chaîne : le rôle
   * {@link STREAM_VIEWER_ROLE_ID} seulement).
   */
  mention?: LiveMentionTarget;
  /**
   * Liens d'une annonce de soirée (un par diffusion, le premier = `streamUrl`),
   * chacun validé par la liste blanche. Le texte les place par des jetons
   * `{{lien:N}}` (N à partir de 1) ; aucun lien n'est alors ajouté en fin.
   */
  streamUrls?: string[];
  /**
   * Message #live déjà publié pour la même soirée : il est **modifié** (aucune
   * nouvelle notification) au lieu d'en poster un nouveau.
   */
  editMessageId?: string;
  /**
   * `false` : nouveau message **sans mention écrite ni notification** — soirée
   * dont le public a peut-être déjà été notifié (premier envoi incertain) sans
   * message connu à modifier. Avec `editMessageId` : le message modifié était
   * parti sans mention, sa modification n'en écrit pas. Absent : notification
   * habituelle.
   */
  notify?: false;
  /**
   * `true` : simple **mise à jour** du message de la soirée (matchs terminés),
   * toujours avec `editMessageId`. Rien n'est à poster à la main si elle
   * échoue : la fin de match ou le direct suivant de la soirée la refera.
   */
  refresh?: true;
}

/** Public d'une annonce : tout le serveur, ou le seul rôle StreamViewer. */
export type LiveMentionTarget = "everyone" | "stream-viewer";

/**
 * Rôle StreamViewer du serveur BlueGenji, seul notifié pour une diffusion qui
 * n'est pas la chaîne officielle. Identifiant public, gardé en un seul endroit.
 */
export const STREAM_VIEWER_ROLE_ID = "1210173681771479060";

/** Nombre maximal de liens d'une annonce de soirée. */
export const MAX_LIVE_STREAM_URLS = 10;

/** Jeton d'emplacement d'un lien dans le texte d'une annonce de soirée. */
const LINK_TOKEN = /\{\{lien:(\d{1,2})\}\}/g;

/** Identifiant de message Discord (snowflake). */
const SNOWFLAKE = /^\d{17,20}$/;

/**
 * Remplace les jetons `{{lien:N}}` par les liens validés de la demande ; un
 * jeton sans lien correspondant disparaît. Sans `streamUrls`, le texte est
 * rendu tel quel.
 *
 * @param text Texte normalisé.
 * @param urls Liens validés.
 * @param wrap Habillage d'un lien (`<…>` au canal de logs : pas d'aperçu).
 * @returns Le texte, liens en place.
 */
export function fillLinkTokens(
  text: string,
  urls: readonly string[] | undefined,
  wrap: (url: string) => string = (url) => url,
): string {
  if (!urls) { return text; }
  return text.replace(LINK_TOKEN, (_token, index: string) => {
    const url = urls[Number(index) - 1];
    return url ? wrap(url) : "";
  });
}

/**
 * Texte de l'annonce tel qu'il peut être cité au canal de logs du staff :
 * `logMessage` s'il a été fourni, sinon `message` (qui ne nomme alors aucun
 * joueur). Jamais le texte publié dans #live quand les deux diffèrent.
 *
 * @param request Demande validée.
 * @returns Le texte à citer.
 */
export function loggedLiveText(request: LiveAnnouncementRequest): string {
  return fillLinkTokens(request.logMessage ?? request.message, request.streamUrls, (url) => `<${url}>`);
}

/** Bilan d'une annonce publiée. */
export interface LiveAnnouncementReport {
  posted: true;
  /** `false` : le bot n'a pas la permission de mentionner tout le monde dans le salon. */
  mentionEveryone: boolean;
  /** `false` : le bot n'a pas la permission d'intégrer des liens (pas d'aperçu de la chaîne). */
  embedLinks: boolean;
  /** Identifiant du message #live publié ou modifié : le site le garde pour les modifications suivantes. */
  messageId: string;
  /** `true` : le message de la soirée a été modifié ; `false` : un nouveau message est parti. */
  edited: boolean;
}

/**
 * L'annonce n'a pas été publiée : salon introuvable, permission manquante,
 * refus explicite de Discord (AutoMod…), ou panne passagère de Discord
 * ({@link LiveChannelUnavailableError.key}). La
 * route en fait un `503` portant la clé (`reason`) ; le site rend sa
 * réservation pour réessayer, sauf après `automod` et `discord-down`
 * ({@link isLiveIssueFinal}). Le jeton d'unicité ({@link liveAnnouncementNonce})
 * écarte le doublon d'un même envoi rejoué dans les quelques minutes.
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
 * Vrai si le lien contient une espace ou un caractère de contrôle : `new URL`
 * les tolère (ou les retire), Discord y lirait du texte.
 */
function hasUrlBreak(value: string): boolean {
  if (/\s/u.test(value)) { return true; }
  return [...value].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}

/** Pages de redirection des plateformes : l'hôte est autorisé, la destination non. */
const REDIRECT_PATHS = /^\/(redirect|attribution_link)(\/|$)/i;

/**
 * Ce qui, une fois décodé, désigne une autre adresse : un schéma suivi d'une
 * barre (`https://`, `https:\\` que les navigateurs lisent pareil), ou une
 * adresse sans schéma (`//hôte`, `\\hôte`). Un caractère de contrôle décodé
 * (tabulation, saut de ligne) est refusé aussi : les navigateurs le retirent
 * avant de lire l'adresse, si bien que `/%09/hôte` vaut `//hôte`.
 */
const EMBEDDED_ADDRESS = /:[\\/]|[\\/]{2}|\\|\p{Cc}/u;

/** Décode jusqu'à stabilité (trois passes au plus) ; `null` si illisible ou encore encodé. */
function fullyDecoded(value: string): string | null {
  let current = value;
  for (let pass = 0; pass < 3; pass++) {
    let next: string;
    try {
      next = decodeURIComponent(current);
    } catch {
      return null;
    }
    if (next === current) { return current; }
    current = next;
  }
  return null;
}

/**
 * Vrai si le lien mène ailleurs que la diffusion : page de redirection (même
 * encodée ou derrière une barre doublée), ou autre adresse portée par le
 * chemin, la requête ou l'ancre — en clair, encodée une ou plusieurs fois,
 * avec ou sans schéma.
 */
function leadsElsewhere(url: URL): boolean {
  const path = fullyDecoded(url.pathname);
  const rest = fullyDecoded(url.search + url.hash);
  if (path === null || rest === null) { return true; }
  if (REDIRECT_PATHS.test(path.replace(/[\\/]+/g, "/"))) { return true; }
  return EMBEDDED_ADDRESS.test(path) || EMBEDDED_ADDRESS.test(rest);
}

/**
 * Désamorce les liens du texte : le seul lien cliquable d'une annonce est
 * `streamUrl`, validé. Le site neutralise déjà les noms ; si une adresse lui
 * échappait, elle ne deviendrait ni lien (`://` coupé d'une espace de largeur
 * nulle) ni lien masqué (`](` coupé de même).
 */
function neutralizeLinks(text: string): string {
  return text.replace(/:\/\//g, ":\u200B//").replace(/\]\(/g, "]\u200B(");
}

/**
 * Forme publiable du lien : `https`, hôte de la liste blanche, sans
 * identifiants ni port, 255 caractères au plus, sans espace ni caractère de
 * contrôle, sans redirection ni autre adresse dans le lien. Seconde
 * barrière — le site valide déjà —, parce que ce lien part devant tout le
 * serveur.
 *
 * C'est la forme **normalisée** (`href`) qui est publiée, pas la chaîne reçue :
 * `new URL` accepte `https://www.twitch.tv/x [Live](https://piege.example)`
 * (espace encodée), et `<`, `>` d'une ancre (`#<@&rôle>`) n'y restent que
 * percent-encodés — ni texte ajouté, ni lien masqué, ni mention.
 *
 * @param value Lien reçu.
 * @returns Le lien à publier, ou `null` s'il est refusé.
 */
export function publishableStreamUrl(value: string): string | null {
  if (value.length > MAX_STREAM_URL_LENGTH || hasUrlBreak(value)) { return null; }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const allowed = url.protocol === "https:"
    && url.username === ""
    && url.password === ""
    && url.port === ""
    && LIVE_HOSTS.has(url.hostname.toLowerCase());
  if (!allowed || leadsElsewhere(url) || url.href.length > MAX_STREAM_URL_LENGTH) { return null; }
  return url.href;
}

/**
 * Vrai si le lien est une diffusion acceptable ({@link publishableStreamUrl}).
 *
 * @param value Lien reçu.
 * @returns `true` si le lien peut être publié.
 */
export function isAllowedStreamUrl(value: string): boolean {
  return publishableStreamUrl(value) !== null;
}

/** Caractères d'une étiquette `context` du site (`live-announce tournoi-7 match-12,13,…+4`). */
const CONTEXT_UNSAFE = /[^A-Za-z0-9 ,+…_-]/gu;

/**
 * Désamorce la syntaxe de mention Discord (`<@id>`, `<@!id>`, `<@&id>`,
 * `<#id>`) : même sans notification (`allowedMentions`), le client la rend
 * sous le nom actuel du membre, du rôle ou du salon — un pseudo apparaîtrait
 * dans #live ou au canal de logs. Une espace de largeur nulle après `<` suffit.
 */
function neutralizeMentionSyntax(text: string): string {
  return text.replace(/<(?=[@#])/g, "<\u200B");
}

/**
 * Texte reçu de l'app, normalisé : fins de ligne en `\n` seul (un `\r` isolé
 * ferait une ligne que la citation du canal de logs, coupée sur `\n`, ne
 * préfixerait pas de « > »), sans mention (de masse ou d'un membre) ni lien,
 * borné.
 */
function normalizeLiveText(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n");
  return cutText(neutralizeLinks(neutralizeMentionSyntax(neutralizeMassMentions(lines))), MAX_LIVE_MESSAGE_LENGTH);
}

/**
 * Valide le corps d'une annonce de live. `logMessage`, facultatif, se valide
 * comme `message` : présent mais vide ou d'un autre type, toute la demande est
 * refusée — retomber sur `message` citerait au staff le pseudo qu'il retire.
 *
 * @param payload Corps JSON brut.
 * @returns La demande normalisée, ou `null` si elle est inexploitable.
 */
export function parseLiveAnnouncement(payload: unknown): LiveAnnouncementRequest | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) { return null; }
  const raw = payload as Record<string, unknown>;
  const message = typeof raw.message === "string" ? raw.message.trim() : "";
  const streamUrl = publishableStreamUrl(typeof raw.streamUrl === "string" ? raw.streamUrl.trim() : "");
  if (!message || !streamUrl) { return null; }
  const hasLogMessage = raw.logMessage !== undefined;
  const logMessage = typeof raw.logMessage === "string" ? raw.logMessage.trim() : "";
  if (hasLogMessage && !logMessage) { return null; }
  // Assez long pour la liste des matchs d'un groupe (`live-announce match-12,13,…`).
  // Coupée d'un « … » visible : un identifiant tronqué ne passe pas pour un autre.
  // Écrite telle quelle dans pm2 et au canal de logs : hors des caractères
  // du site, rien ne passe (ni saut de ligne qui forgerait une ligne de
  // journal, ni balisage qui ferait un lien masqué).
  const rawContext = typeof raw.context === "string" ? raw.context.trim().replace(CONTEXT_UNSAFE, "_") : "";
  const context = rawContext ? cutText(rawContext, MAX_LIVE_CONTEXT_LENGTH) : "live-announce";
  const request: LiveAnnouncementRequest = { message: normalizeLiveText(message), streamUrl, context };
  if (hasLogMessage) { request.logMessage = normalizeLiveText(logMessage); }
  return withEveningFields(request, raw);
}

/**
 * Champs d'une annonce de soirée, tous facultatifs (un site plus ancien ne les
 * envoie pas) : public, liens, message à modifier.
 *
 * @returns La demande complétée, ou `null` si un champ fourni est invalide.
 */
function withEveningFields(request: LiveAnnouncementRequest, raw: Record<string, unknown>): LiveAnnouncementRequest | null {
  if (raw.mention !== undefined) {
    if (raw.mention !== "everyone" && raw.mention !== "stream-viewer") { return null; }
    request.mention = raw.mention;
  }
  if (raw.streamUrls !== undefined) {
    const urls = parseStreamUrls(raw.streamUrls, request.streamUrl);
    if (!urls) { return null; }
    request.streamUrls = urls;
  }
  if (raw.editMessageId !== undefined) {
    if (typeof raw.editMessageId !== "string" || !SNOWFLAKE.test(raw.editMessageId)) { return null; }
    request.editMessageId = raw.editMessageId;
  }
  if (raw.notify !== undefined) {
    if (raw.notify !== false) { return null; }
    request.notify = false;
  }
  return withRefresh(request, raw.refresh);
}

/**
 * Marque de mise à jour (`refresh`) : `true` seulement, et avec
 * `editMessageId` — une mise à jour modifie un message connu, jamais n'en
 * crée un premier.
 *
 * @returns La demande, ou `null` si la marque est invalide.
 */
function withRefresh(request: LiveAnnouncementRequest, refresh: unknown): LiveAnnouncementRequest | null {
  if (refresh === undefined) { return request; }
  if (refresh !== true || request.editMessageId === undefined) { return null; }
  request.refresh = true;
  return request;
}


/**
 * Liens d'une annonce de soirée : un tableau de 1 à {@link MAX_LIVE_STREAM_URLS}
 * liens de la liste blanche, le premier égal à `streamUrl`.
 *
 * @returns Les liens normalisés, ou `null` si un seul est refusé.
 */
function parseStreamUrls(value: unknown, streamUrl: string): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_LIVE_STREAM_URLS) { return null; }
  const urls = value.map((url) => publishableStreamUrl(typeof url === "string" ? url.trim() : ""));
  if (urls[0] !== streamUrl || urls.some((url) => url === null)) { return null; }
  return urls as string[];
}

/** Mention écrite en tête du message, selon le public. */
export function mentionPrefix(target: LiveMentionTarget | undefined): string {
  return target === "stream-viewer" ? `<@&${STREAM_VIEWER_ROLE_ID}> ` : EVERYONE_PREFIX;
}

/**
 * Texte publié : la mention, le message de l'app, puis le lien seul sur sa
 * ligne (Discord en tire l'aperçu de la chaîne). Une annonce de soirée
 * (`streamUrls`) porte ses liens dans le texte, à la place des jetons
 * `{{lien:N}}` : aucun lien n'est ajouté en fin. Sans la permission de
 * mentionner, la mention n'est pas écrite : une mention grise qui ne notifie
 * personne aurait l'air d'une panne. Le message est raccourci pour que
 * l'ensemble tienne dans les 2 000 caractères d'un message Discord.
 *
 * @param request Demande validée.
 * @param mentionEveryone `false` : le bot ne peut pas notifier (pas de mention écrite).
 * @returns Le contenu du message Discord.
 */
export function formatLiveAnnouncement(request: LiveAnnouncementRequest, mentionEveryone = true): string {
  const prefix = mentionEveryone ? mentionPrefix(request.mention) : "";
  if (request.streamUrls) {
    const filled = fillLinkTokens(request.message, request.streamUrls);
    return `${prefix}${cutText(filled, DISCORD_MAX_CONTENT_LENGTH - prefix.length)}`;
  }
  const budget = DISCORD_MAX_CONTENT_LENGTH - prefix.length - 1 - request.streamUrl.length;
  return `${prefix}${cutText(request.message, budget)}\n${request.streamUrl}`;
}

/**
 * Mentions autorisées d'un envoi : `@everyone` pour la chaîne officielle, le
 * seul rôle StreamViewer pour les autres, rien du tout pour une suite ou un
 * message parti sans mention (aucune nouvelle notification).
 *
 * @param target Public de l'annonce.
 * @param notify `false` : suite, message sans mention, ou permission absente.
 */
export function liveAllowedMentions(target: LiveMentionTarget | undefined, notify: boolean): AllowedMentions {
  if (!notify) { return { parse: [], roles: [] }; }
  if (target === "stream-viewer") { return { parse: [], roles: [STREAM_VIEWER_ROLE_ID] }; }
  return { parse: ["everyone"], roles: [] };
}

type AllowedMentions = { parse: "everyone"[]; roles: string[] };


type SendableChannel = {
  send: (options: {
    content: string;
    allowedMentions: AllowedMentions;
    nonce: string;
    enforceNonce: boolean;
  }) => Promise<{ id: string }>;
  messages?: {
    edit: (id: string, options: { content: string; allowedMentions: AllowedMentions }) => Promise<{ id: string }>;
  };
  permissionsFor?: (user: unknown) => { has: (flag: bigint) => boolean } | null;
};

/** Message inconnu : supprimé depuis, ou d'un autre salon. */
const UNKNOWN_MESSAGE = 10008;

/** Modification refusée : le message n'est pas du bot. */
const CANNOT_EDIT_OTHERS = 50005;

/**
 * Plafond des modifications d'un message vieux de plus d'une heure : le
 * message de la soirée ne se modifie plus pour un temps.
 */
const EDIT_LIMIT_REACHED = 30046;

/**
 * Refus qui rendent le message de la soirée non modifiable : une suite part à
 * sa place. Un message **inconnu** (`10008`) n'en fait pas partie : supprimé de
 * #live — souvent par le staff, sur demande —, il n'est pas republié par une
 * suite ({@link MESSAGE_DELETED}).
 */
const NOT_EDITABLE: ReadonlySet<number> = new Set([CANNOT_EDIT_OTHERS, EDIT_LIMIT_REACHED]);

/**
 * Clé d'incident d'un message de la soirée supprimé : le site ferme la soirée
 * de ce public (plus rien n'y est publié jusqu'à la fin de sa fenêtre).
 */
export const MESSAGE_DELETED = "message-deleted";

/**
 * Lit les permissions du bot dans le salon. Un salon qui ne les expose pas (ou
 * un client sans utilisateur) est tenu pour accessible : l'envoi dira le reste.
 */
function readPermissions(
  client: Client,
  channel: SendableChannel,
): { canView: boolean; canSend: boolean; canMentionEveryone: boolean; canEmbedLinks: boolean } {
  const permissions = client.user && channel.permissionsFor ? channel.permissionsFor(client.user) : null;
  if (!permissions) { return { canView: true, canSend: true, canMentionEveryone: true, canEmbedLinks: true }; }
  // Pas de mode lent à surveiller : Discord n'y soumet pas les bots.
  return {
    canView: permissions.has(PermissionFlagsBits.ViewChannel),
    canSend: permissions.has(PermissionFlagsBits.SendMessages),
    canMentionEveryone: permissions.has(PermissionFlagsBits.MentionEveryone),
    canEmbedLinks: permissions.has(PermissionFlagsBits.EmbedLinks),
  };
}

/**
 * Modifie le message de la soirée, en un seul appel à Discord (aucune lecture
 * préalable du message). `null` si le message n'est plus modifiable (pas du
 * bot, plafond de modifications atteint) : l'appelant poste alors une
 * suite sans notification.
 *
 * @throws {LiveChannelUnavailableError} Toute autre erreur de Discord.
 */
async function editEveningMessage(
  channel: SendableChannel,
  messageId: string,
  content: string,
  allowedMentions: AllowedMentions,
): Promise<string | null> {
  if (!channel.messages) { return null; }
  try {
    const edited = await channel.messages.edit(messageId, { content, allowedMentions });
    return edited.id;
  } catch (error) {
    const code = discordCode(error);
    if (code !== undefined && NOT_EDITABLE.has(code)) { return null; }
    if (code === UNKNOWN_MESSAGE) {
      const detail = (error as Error).message;
      throw new LiveChannelUnavailableError(MESSAGE_DELETED, `message de la soirée supprimé (${detail})`, detail);
    }
    throw sendFailure(error);
  }
}

/**
 * Publie l'annonce dans le salon #live.
 *
 * - Nouvelle soirée : un message qui notifie son public — `@everyone` pour la
 *   chaîne officielle, le rôle StreamViewer pour toute autre chaîne.
 * - Soirée déjà annoncée (`editMessageId`) : le message est **modifié**, sans
 *   nouvelle notification ; s'il n'est plus modifiable (pas du bot, plafond de
 *   modifications de Discord atteint), une suite part **sans aucune mention**.
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

  const { canView, canSend, canMentionEveryone, canEmbedLinks } = readPermissions(client, channel);
  if (!canView) { throw new LiveChannelUnavailableError("no-view", "permission de voir le salon absente"); }
  if (!canSend) { throw new LiveChannelUnavailableError("no-send", "permission d'écrire absente"); }

  const report = { posted: true as const, mentionEveryone: canMentionEveryone, embedLinks: canEmbedLinks };
  if (request.editMessageId) {
    // Un message parti sans mention (`notify: false`) n'en reçoit pas à sa
    // modification. Celui qui a notifié garde sa mention, autorisée de nouveau :
    // sans elle, Discord la recalculerait comme ne visant personne (surlignage
    // et « Mentions récentes » perdus). Une modification ne notifie jamais.
    const mention = canMentionEveryone && request.notify !== false;
    const content = formatLiveAnnouncement(request, mention);
    const editedId = await editEveningMessage(
      channel,
      request.editMessageId,
      content,
      liveAllowedMentions(request.mention, mention),
    );
    if (editedId) { return { ...report, messageId: editedId, edited: true }; }
  }
  // Suite d'une soirée dont le message ne se modifie plus, ou soirée peut-être déjà
  // notifiée (`notify: false`) : ni mention écrite, ni notification.
  const followUp = request.editMessageId !== undefined || request.notify === false;
  try {
    // Une seule mention autorisée, celle du public de l'annonce ; toute mention
    // du texte est neutralisée (`parseLiveAnnouncement`) : seule celle de tête notifie.
    // Le jeton d'unicité empêche Discord de créer deux fois la même annonce.
    const sent = await channel.send({
      content: formatLiveAnnouncement(request, canMentionEveryone && !followUp),
      allowedMentions: liveAllowedMentions(request.mention, canMentionEveryone && !followUp),
      nonce: liveAnnouncementNonce(request),
      enforceNonce: true,
    });
    return { ...report, messageId: sent.id, edited: false };
  } catch (error) {
    throw sendFailure(error);
  }
}
