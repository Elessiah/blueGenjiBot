/**
 * Salons vocaux d'équipe d'un match (MATCH-VOICE).
 *
 * Le site demande, un quart d'heure avant un match, un salon vocal par équipe
 * dans la catégorie `VOICE_CATEGORY_ID`, puis le rend une fois le score
 * confirmé ; le lancement du match n'en dépend pas, et le site ne demande
 * jamais qui s'y trouve, ni combien. Le bot crée et supprime ; il ne décide de rien.
 *
 * Règles tenues ici :
 * - **idempotence** : une même clé (`match:<id>:team:<id>`) rend toujours le
 *   même salon, recréé s'il a été supprimé à la main ;
 * - **suppression par la modération** : un salon suivi et pas encore libéré
 *   est recréé aussitôt par le bot (`channelDelete`, décision D97), sous la
 *   même clé ; l'ancien identifiant, que le site garde jusqu'à sa revérification
 *   suivante (5 min), désigne encore le salon neuf tant que le bot tourne
 *   (`REPLACED_ALIAS_MAX` alias au plus) ; pas de recréation au-delà de
 *   `RECREATE_MAX` par clé en 10 minutes, ni pour un salon de plus de 48 h ;
 * - **seul un salon suivi** (table `MatchVoiceChannel`) peut être rendu ou
 *   supprimé : un identifiant quelconque envoyé par le site n'y donne accès à
 *   rien ;
 * - **suppression** : à la libération si le salon est vide, sinon dès qu'il se
 *   vide (`voiceStateUpdate`, sans scrutation) ; balayage au démarrage et toutes
 *   les 30 min (libéré et vide, libéré depuis plus de 24 h, jamais libéré
 *   depuis plus de 48 h et vide — un salon jamais libéré et occupé n'est
 *   jamais supprimé) ;
 * - **catégorie** : un salon suivi déplacé hors de la catégorie n'est plus
 *   rendu ni supprimé : il est oublié ;
 * - **vider** : l'arbitrage (arbitres et administrateurs) ou l'équipe (son propre salon) peut faire déconnecter tous les occupants d'un
 *   salon suivi (les salons sont ouverts à qui voit la catégorie) ;
 * - **vie privée** : seul importe qu'un salon soit vide ou non ; aucun membre,
 *   identifiant de membre ni pseudo n'est rendu au site, stocké ou journalisé.
 */

import { ChannelType, type Client, type VoiceState } from "discord.js";
import { getBddInstance } from "../bdd/Bdd.js";
import {
  MAX_CAUSE_DEPTH,
  discordJsonCode,
  isTransientNetworkError,
  safeErrorCode,
  safeErrorKind,
  safeErrorStatus,
} from "../safe/errorGuards.js";
import { sendAlert, sendLog } from "../safe/sendLog.js";

/** Catégorie des salons vocaux de match sur le serveur BlueGenji, quand `VOICE_CATEGORY_ID` n'est pas posé. */
export const DEFAULT_VOICE_CATEGORY_ID = "676735851119640577";

/** Places d'un salon vocal d'équipe : cinq joueurs. */
export const VOICE_USER_LIMIT = 5;

/** Longueur maximale d'un nom de salon Discord. */
export const MAX_VOICE_NAME_LENGTH = 100;

/** Longueur maximale du nom reçu, avant nettoyage : au-delà, la demande est refusée. */
const MAX_RAW_NAME_LENGTH = 200;

/**
 * Nom de repli : retenu quand le nom d'équipe ne garde aucun caractère affichable,
 * et envoyé tel quel par le site quand le bot a refusé le nom de l'équipe. Jamais
 * donné tel quel à un salon : `voiceChannelName` le rend bilingue et propre à l'équipe.
 */
export const FALLBACK_VOICE_NAME = "Salon d'équipe";

/** Repli affiché, bilingue : les deux équipes d'un match s'y distinguent par leur numéro. */
export const FALLBACK_VOICE_LABEL = "Salon d'équipe / Team channel";

/** Numéro d'équipe d'une clé du site (`match:<id>:team:<id>`). */
const KEY_TEAM_PATTERN = /:team:(\d{1,20})$/;

/** Un salon libéré mais occupé est supprimé quand même après ce délai. */
export const RELEASED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Un salon jamais libéré (le site n'a plus répondu) est supprimé après ce délai. */
export const UNRELEASED_MAX_AGE_MS = 48 * 60 * 60 * 1000;

/** Expression cron du balayage : toutes les 30 minutes. */
export const VOICE_SWEEP_CRON = "*/30 * * * *";

/** Un salon suivi que le bot ne voit plus est oublié après ce délai (le double du plafond de 48 h). */
export const ABANDONED_MAX_AGE_MS = 2 * UNRELEASED_MAX_AGE_MS;

/** Délai entre deux alertes « permission manquante ». */
const PERMISSION_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

/** Codes Discord d'un salon inconnu (supprimé) et d'un accès refusé. */
const UNKNOWN_CHANNEL = 10003;
const MISSING_ACCESS = 50001;
const MISSING_PERMISSIONS = 50013;

/** Motif d'une clé d'idempotence acceptée. */
const VOICE_KEY_PATTERN = /^[A-Za-z0-9:_-]{1,100}$/;

/** Motif d'un identifiant Discord. */
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

/** Raison inscrite au journal d'audit Discord à chaque suppression. */
const DELETE_REASON = "Salon vocal de match terminé";

/**
 * Motif du journal d'audit de Discord quand un salon est vidé : neutre, aucun nom ni
 * auteur — l'arbitrage (D13) comme l'équipe (propriétaire, manager, capitaine, D36)
 * passent par la même route du bot, qui ne sait pas qui a demandé le vidage.
 */
const CLEAR_REASON = "Salon vocal de match vidé";

/** Discord : le membre n'est plus dans un salon vocal (parti entre la lecture et la déconnexion). */
const TARGET_NOT_IN_VOICE = 40032;

/** Code d'erreur rendu au site. */
export type VoiceErrorCode =
  | "VOICE_CATEGORY_UNAVAILABLE"
  | "VOICE_MISSING_PERMISSIONS"
  | "VOICE_DISCORD_ERROR"
  | "VOICE_DISCORD_UNAVAILABLE"
  | "VOICE_STORAGE_ERROR";

/** Statut HTTP de chaque code. */
const STATUS_BY_CODE: Readonly<Record<VoiceErrorCode, number>> = {
  VOICE_CATEGORY_UNAVAILABLE: 503,
  VOICE_MISSING_PERMISSIONS: 503,
  VOICE_DISCORD_ERROR: 502,
  // Limite de débit ou panne de Discord : vaut pour tous les salons, le site arrête sa passe.
  VOICE_DISCORD_UNAVAILABLE: 503,
  VOICE_STORAGE_ERROR: 500,
};

/** Opération en cours d'un échec, seul texte libre du journal d'un `VoiceChannelError`. */
export type VoiceErrorContext =
  | "lecture du salon"
  | "suppression du salon"
  | "lecture de la catégorie"
  | "création du salon"
  | "catégorie introuvable"
  | "déconnexion des membres"
  | "stockage";

/** Échec d'une opération sur un salon vocal, porteur du code rendu au site. */
export class VoiceChannelError extends Error {
  readonly code: VoiceErrorCode;
  readonly status: number;

  /**
   * Le message, seul journalisé, est fait du contexte (texte du bot), de l'identifiant
   * Discord en cause (configuration) et du code de la cause (`voiceErrorDetail`) :
   * jamais d'un texte reçu.
   * @param code Code rendu au site.
   * @param context Opération en cours.
   * @param cause Erreur d'origine, réduite à son code.
   * @param subjectId Identifiant Discord en cause (catégorie introuvable) ; ignoré s'il n'en a pas la forme.
   */
  constructor(code: VoiceErrorCode, context?: VoiceErrorContext, cause?: unknown, subjectId?: string) {
    const subject = subjectId !== undefined && SNOWFLAKE_PATTERN.test(subjectId) ? ` (${subjectId})` : "";
    const head = context === undefined ? code : `${context}${subject}`;
    super(cause === undefined ? head : `${head} : ${voiceErrorDetail(cause)}`);
    this.name = "VoiceChannelError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

/** Ligne de `MatchVoiceChannel`. */
type TrackedRow = { channel_id: string; voice_key: string; created_at: number; released_at: number | null };

/** Ce que le bot lit d'un salon vocal suivi : son effectif et sa suppression. */
type VoiceHandle = { id: string; parentId?: string | null; members: { size: number }; delete(reason?: string): Promise<unknown> };

/** Occupant d'un salon tel que le bot le déconnecte : rien d'autre n'en est lu. */
type VoiceOccupant = { voice: { disconnect(reason?: string): Promise<unknown> } };

/** Salon vocal dont les occupants sont lus pour être déconnectés (`clearVoiceChannel`). */
type ClearableVoice = VoiceHandle & { members: { size: number; values(): Iterable<VoiceOccupant> } };

/**
 * Un salon est-il encore un salon vocal de match : rangé dans la catégorie ?
 * Un salon suivi que le staff a déplacé ailleurs (archive, staff) n'est plus
 * le nôtre : il n'est ni rendu au site, ni supprimé — seulement oublié.
 * @param channel Salon lu.
 * @returns `true` s'il est dans la catégorie des salons vocaux de match.
 */
function inVoiceCategory(channel: Pick<VoiceHandle, "parentId">): boolean {
  return channel.parentId === voiceCategoryId();
}

/**
 * Anciens identifiants retenus au plus (mémoire bornée) : le plus ancien est oublié au-delà.
 * Aucune durée : le site garde l'ancien identifiant jusqu'à sa revérification suivante
 * (5 min, `VOICE_RECHECK_MINUTES` du site), plus longtemps s'il reste sans activité ; un
 * identifiant de salon Discord n'est jamais réattribué, l'alias ne peut viser que son salon neuf.
 */
export const REPLACED_ALIAS_MAX = 200;

/**
 * Recréations au plus d'une même clé par `RECREATE_WINDOW_MS` : au-delà (suppressions en boucle
 * par la modération ou un autre bot), le salon supprimé cesse d'être suivi au lieu d'être recréé,
 * et la revérification du site en rouvre un, au plus une fois par 5 min. Aucune boucle
 * suppression/recréation ne peut épuiser la limite de débit de Discord ni la mémoire des alias.
 */
export const RECREATE_MAX = 3;

/** Fenêtre du plafond de recréations d'une clé (`RECREATE_MAX`). */
export const RECREATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Fait de la place dans une mémoire bornée : au plafond atteint, la plus ancienne entrée (ordre
 * d'insertion) est oubliée.
 * @param collection Ensemble ou table à borner.
 * @param max Taille maximale.
 */
function makeRoom<K>(collection: Map<K, unknown> | Set<K>, max: number): void {
  if (collection.size < max) { return; }
  const oldest = collection.keys().next();
  if (!oldest.done) { collection.delete(oldest.value); }
}

/** Bilan d'un balayage. */
export type SweepReport = { deleted: number; untracked: number; kept: number; failed: number };

/** Salons suivis et libérés : ceux qu'un départ peut faire supprimer. Rechargé à chaque balayage. */
const releasedIds = new Set<string>();

/**
 * Salons supprimés par la modération puis recréés : ancien identifiant → salon neuf.
 * Mémoire seule (des identifiants de salons, aucun membre), perdue au redémarrage du bot.
 */
const replacedIds = new Map<string, string>();

/**
 * Salons que le bot supprime lui-même (rendus vides, balayage) : leur `channelDelete` ne les
 * recrée jamais, même si leur retrait du suivi a échoué. Retiré à la réception de l'événement ;
 * borné à `REPLACED_ALIAS_MAX` (un événement manqué ne laisse pas grossir l'ensemble).
 */
const botDeletedIds = new Set<string>();

/** Instants des recréations récentes par clé (`RECREATE_MAX`), bornés à `REPLACED_ALIAS_MAX` clés. */
const recreatedAt = new Map<string, number[]>();

/** Créations en cours par clé : deux demandes simultanées ne créent qu'un salon. */
const pendingByKey = new Map<string, Promise<unknown>>();

/** Dernière alerte « permission refusée », par permission nommée : l'une ne tait pas l'autre. */
const lastPermissionAlertAt = new Map<string, number>();

/**
 * Refus valant pour tous les salons (limite de débit ou panne de Discord, permission,
 * catégorie) : chaque passe du site les reçoit de nouveau, ils ne vont au salon de logs
 * qu'une fois par code et par `BOT_WIDE_LOG_COOLDOWN_MS` — sans quoi le journal ajouterait
 * des appels à Discord pendant sa propre limite de débit. Un refus propre au salon y va une
 * fois par code **et par détail** (code de Discord) dans le même délai : un refus qui touche
 * chaque salon (limite de salons du serveur) n'inonde pas le salon de logs.
 */
const BOT_WIDE_VOICE_CODES: ReadonlySet<LoggedVoiceCode> = new Set<LoggedVoiceCode>([
  "VOICE_DISCORD_UNAVAILABLE",
  "VOICE_MISSING_PERMISSIONS",
  "VOICE_CATEGORY_UNAVAILABLE",
  // Stockage du bot et erreur imprévue : le site les lit aussi comme valant pour tous les salons.
  "VOICE_STORAGE_ERROR",
  "VOICE_INTERNAL_ERROR",
]);

/** Code d'un refus journalisé : ceux rendus au site, et l'erreur imprévue (`VOICE_INTERNAL_ERROR`). */
export type LoggedVoiceCode = VoiceErrorCode | "VOICE_INTERNAL_ERROR";

/** Origine d'un échec journalisé : route appelée par le site, ou événement Discord. */
export type VoiceLogScope = "route" | "event";

/** Délai entre deux journaux Discord d'un même refus. */
export const BOT_WIDE_LOG_COOLDOWN_MS = 10 * 60 * 1000;

/** Refus distincts retenus au plus : le plus ancien est oublié au-delà (mémoire bornée). */
const LOGGED_REFUSALS_MAX = 100;

/** Dernier journal Discord de chaque refus (code, ou code et détail pour un refus propre au salon). */
const botWideLoggedAt = new Map<string, number>();

/**
 * Le refus doit-il partir au salon de logs ? Une fois par `BOT_WIDE_LOG_COOLDOWN_MS` : par code
 * pour un refus valant pour tous les salons, par code et détail pour un refus propre au salon.
 * @param code Code du refus.
 * @param now Instant courant (ms), pour les tests.
 * @param detail Détail sûr du refus (`voiceErrorDetail`) : deux refus différents partent tous deux.
 * @param scope Origine (`route` : appel du site ; `event` : suppression ou retrait du suivi sur un
 *   événement Discord) — un refus d'une route ne tait pas l'échec d'un événement, qui nomme un salon.
 * @returns `true` s'il faut journaliser sur Discord.
 */
export function shouldLogVoiceError(
  code: LoggedVoiceCode,
  now: number = Date.now(),
  detail: string = "",
  scope: VoiceLogScope = "route",
): boolean {
  const key = BOT_WIDE_VOICE_CODES.has(code) ? `${scope}|${code}` : `${scope}|${code}|${detail}`;
  const last = botWideLoggedAt.get(key);
  if (last !== undefined && now - last < BOT_WIDE_LOG_COOLDOWN_MS) { return false; }
  botWideLoggedAt.delete(key);
  makeRoom(botWideLoggedAt, LOGGED_REFUSALS_MAX);
  botWideLoggedAt.set(key, now);
  return true;
}

/**
 * Journalise un échec vocal au salon de logs au plus une fois par délai (`shouldLogVoiceError`,
 * par code de l'erreur — `VOICE_INTERNAL_ERROR` hors `VoiceChannelError`), sinon à pm2 : un
 * échec répété (limite de débit de Discord) n'ajoute pas d'appels à Discord.
 * @param client Client Discord, pour le journal.
 * @param error Erreur capturée.
 * @param message Message sûr (contexte, identifiant, `voiceErrorDetail`), jamais un texte reçu.
 * @param scope Origine de l'échec (`shouldLogVoiceError`).
 * @param quietMessage Ligne pm2 quand le salon de logs l'a déjà reçu (par défaut `message`).
 */
export async function logVoiceFailure(
  client: Client,
  error: unknown,
  message: string,
  scope: VoiceLogScope,
  quietMessage: string = message,
): Promise<void> {
  const code: LoggedVoiceCode = error instanceof VoiceChannelError ? error.code : "VOICE_INTERNAL_ERROR";
  if (shouldLogVoiceError(code, Date.now(), voiceErrorDetail(error), scope)) {
    await sendLog(client, message);
  } else {
    console.warn(`[voice] ${quietMessage}`);
  }
}

/** Remet à zéro l'état du module (alerte limitée, cache des libérés) ; pour les tests. */
export function resetVoiceState(): void {
  lastPermissionAlertAt.clear();
  botWideLoggedAt.clear();
  releasedIds.clear();
  pendingByKey.clear();
  replacedIds.clear();
  botDeletedIds.clear();
  recreatedAt.clear();
}

/**
 * Catégorie des salons vocaux : `VOICE_CATEGORY_ID`, sinon la catégorie
 * BlueGenji. Une valeur qui n'est pas un identifiant Discord est ignorée.
 * @returns L'identifiant de la catégorie.
 */
export function voiceCategoryId(): string {
  const configured = process.env.VOICE_CATEGORY_ID?.trim();
  return configured && SNOWFLAKE_PATTERN.test(configured) ? configured : DEFAULT_VOICE_CATEGORY_ID;
}

/**
 * Valide la clé d'idempotence fournie par le site.
 * @param raw Valeur brute du corps.
 * @returns La clé, ou `null` si elle est absente ou hors du motif (lettres, chiffres, `:`, `_`, `-`, 100 caractères au plus).
 */
export function parseVoiceKey(raw: unknown): string | null {
  return typeof raw === "string" && VOICE_KEY_PATTERN.test(raw) ? raw : null;
}

/**
 * Valide un identifiant de salon passé dans le chemin.
 * @param raw Valeur brute.
 * @returns L'identifiant, ou `null`.
 */
export function parseChannelId(raw: unknown): string | null {
  return typeof raw === "string" && SNOWFLAKE_PATTERN.test(raw) ? raw : null;
}

/**
 * Nom du salon tiré du nom d'équipe envoyé par le site.
 *
 * Caractères de contrôle remplacés par une espace, caractères invisibles et de
 * sens d'écriture (espace sans chasse, marques et forçages bidirectionnels,
 * BOM) retirés — le liant `ZWJ` des emoji composés est gardé —, ainsi que ceux qui servent la
 * syntaxe des mentions et du Markdown (`@ < > \` * _ ~ | \\ #`) : un nom
 * d'équipe saisi librement ne doit rien appeler ni rien mettre en forme s'il
 * est repris ailleurs. Espaces resserrés, coupe à 100 caractères (points de
 * code, pour ne pas couper un emoji en deux).
 *
 * Une chaîne vide dit qu'il ne reste aucun caractère affichable : la route
 * donne alors le nom de repli ({@link voiceChannelName}).
 *
 * @param raw Valeur brute du corps.
 * @returns Le nom nettoyé (vide s'il ne reste rien), ou `null` pour une valeur inexploitable.
 */
export function cleanVoiceChannelName(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "" || raw.length > MAX_RAW_NAME_LENGTH) { return null; }
  const cleaned = raw
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/[\u00AD\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g, "")
    .replace(/[@<>`*_~|\\#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return Array.from(cleaned).slice(0, MAX_VOICE_NAME_LENGTH).join("").trim();
}

/**
 * Drapeau `fallback` du corps de `POST /internal/voice/channels` : `true` quand le
 * site envoie son nom de repli (le bot a refusé celui de l'équipe), `false` pour un
 * vrai nom d'équipe. Absent (site antérieur) ou d'un autre type : `undefined`, et le
 * repli se reconnaît alors à l'égalité du nom.
 * @param raw Valeur brute du corps.
 * @returns Le drapeau, ou `undefined`.
 */
export function parseVoiceFallback(raw: unknown): boolean | undefined {
  return typeof raw === "boolean" ? raw : undefined;
}

/**
 * Nom donné au salon : le nom nettoyé, sauf le repli, rendu bilingue et suivi du
 * numéro d'équipe de la clé — les deux équipes d'un match n'ont jamais le même
 * salon de repli. Un numéro d'équipe n'est pas un pseudo. Le repli est dit par le
 * site (`fallback`) : une équipe nommée « Salon d'équipe » garde son nom. Sans le
 * drapeau (site antérieur), il se reconnaît à l'égalité avec `FALLBACK_VOICE_NAME`.
 * @param key Clé d'idempotence validée.
 * @param name Nom nettoyé (`cleanVoiceChannelName`).
 * @param fallback Drapeau du site (`parseVoiceFallback`), `undefined` s'il est absent.
 * @returns Le nom du salon.
 */
export function voiceChannelName(key: string, name: string, fallback?: boolean): string {
  const isFallback = fallback ?? name === FALLBACK_VOICE_NAME;
  if (!isFallback) { return name; }
  const team = KEY_TEAM_PATTERN.exec(key)?.[1];
  return team === undefined ? FALLBACK_VOICE_LABEL : `${FALLBACK_VOICE_LABEL} ${team}`;
}

/**
 * Premier code sûr de la chaîne `cause` (profondeur bornée) : une panne réseau
 * (`TypeError: fetch failed`) porte le sien (`ECONNRESET`) dans sa cause.
 * @param error Erreur capturée.
 * @returns Le code, ou `null`.
 */
function causeCode(error: unknown): string | number | null {
  let current: unknown = error;
  for (let depth = 0; depth <= MAX_CAUSE_DEPTH && typeof current === "object" && current !== null; depth++) {
    const code = safeErrorCode(current);
    if (code !== null) { return code; }
    try {
      const next: unknown = (current as { cause?: unknown }).cause;
      current = next === current ? null : next;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Coupure réseau passagère vers Discord ? Lire la chaîne `cause` peut lever (accesseur,
 * Proxy révoqué) : illisible vaut « non », jamais une exception sur un chemin d'erreur.
 * @param error Erreur capturée.
 * @returns `true` pour une coupure DNS/TCP transitoire.
 */
function transientNetwork(error: unknown): boolean {
  try {
    return isTransientNetworkError(error);
  } catch {
    return false;
  }
}

/**
 * Désigne une erreur pour le journal par son type et son code : le message d'une
 * erreur Discord ou SQLite peut recopier une valeur reçue (nom d'équipe, clé).
 * Un `VoiceChannelError` est rendu par son code et son message (déjà sûr ; le code
 * n'est pas répété quand le message l'égale) ; une autre erreur par son type
 * (`TypeError`, `AbortError`, `DiscordAPIError`…), son code (suivi dans `cause`),
 * son statut HTTP s'il y en a un (429, 5xx de Discord), et « réseau » pour une
 * coupure passagère — jamais confondue avec un refus de Discord.
 * @param error Erreur capturée.
 * @returns `<type>, code <code>[, statut <n>][, réseau]`, ou `<CODE>[ (<message>)]`.
 */
export function voiceErrorDetail(error: unknown): string {
  if (error instanceof VoiceChannelError) {
    return error.message === error.code ? error.code : `${error.code} (${error.message})`;
  }
  const code = causeCode(error);
  const status = safeErrorStatus(error);
  const shownStatus = status === null ? "" : ", statut " + String(status);
  const network = transientNetwork(error) ? ", réseau" : "";
  return `${safeErrorKind(error)}, code ${code ?? "inconnu"}${shownStatus}${network}`;
}

/**
 * Traduit une erreur Discord en code rendu au site. Une permission manquante
 * déclenche une alerte au staff (au plus une par heure) : il faut accorder
 * « Gérer les salons » au rôle du bot sur la catégorie.
 * @param client Client Discord, pour l'alerte.
 * @param error Erreur capturée.
 * @param action Action en cours, pour le journal.
 * @returns L'erreur à lever.
 */
async function toVoiceError(client: Client, error: unknown, action: VoiceErrorContext): Promise<VoiceChannelError> {
  if (error instanceof VoiceChannelError) { return error; }
  const code = discordJsonCode(error);
  if (code === MISSING_PERMISSIONS || code === MISSING_ACCESS) {
    const now = Date.now();
    const permission = permissionFor(action);
    if (now - (lastPermissionAlertAt.get(permission) ?? Number.NEGATIVE_INFINITY) >= PERMISSION_ALERT_COOLDOWN_MS) {
      lastPermissionAlertAt.set(permission, now);
      await sendAlert(
        client,
        `Salons vocaux de match : permission refusée par Discord (${action}). Le rôle du bot doit avoir « ${permission} » ` +
          `sur la catégorie ${voiceCategoryId()} (action requise sur Discord ; signalé au plus une fois par heure).`,
      );
    }
    return new VoiceChannelError("VOICE_MISSING_PERMISSIONS", action, error);
  }
  // Limite de débit, panne de Discord (sans code JSON), coupure réseau ou délai dépassé (sans
  // statut) : tous les salons suivants échoueraient de même, le site arrête sa passe au lieu
  // d'appeler pour chacun.
  if (discordUnavailable(error)) {
    return new VoiceChannelError("VOICE_DISCORD_UNAVAILABLE", action, error);
  }
  return new VoiceChannelError("VOICE_DISCORD_ERROR", action, error);
}

/**
 * Discord saturé (429), en panne (5xx, sans code JSON), ou injoignable (coupure réseau, délai
 * dépassé, sans statut) : tout appel suivant échouerait de même.
 * @param error Erreur levée par discord.js.
 * @returns `true` si l'erreur vaut pour tout appel, pas pour un seul salon ou occupant.
 */
function discordUnavailable(error: unknown): boolean {
  if (discordJsonCode(error) !== null) { return false; }
  const status = safeErrorStatus(error);
  if (status !== null) { return status === 429 || status >= 500; }
  return transientNetwork(error) || safeErrorKind(error) === "AbortError";
}

/**
 * Permission Discord que demande une opération, nommée dans l'alerte au staff.
 * @param action Opération en cours.
 * @returns Le nom de la permission sur Discord.
 */
function permissionFor(action: VoiceErrorContext): string {
  return action === "déconnexion des membres" ? "Déplacer des membres" : "Gérer les salons";
}

/**
 * Lit un salon vocal sur Discord.
 * @param client Client Discord.
 * @param channelId Identifiant du salon.
 * @returns Le salon, ou `null` s'il n'existe plus (supprimé à la main) ou n'est plus dans la catégorie (déplacé à la main).
 */
async function fetchVoice(client: Client, channelId: string): Promise<VoiceHandle | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    // Un salon d'un autre type n'est pas un salon vocal de match : ses `members`
    // seraient ceux qui le voient, pas ses occupants.
    if (channel?.type !== ChannelType.GuildVoice) { return null; }
    const voice = channel as unknown as VoiceHandle;
    return inVoiceCategory(voice) ? voice : null;
  } catch (error) {
    if (discordJsonCode(error) === UNKNOWN_CHANNEL) { return null; }
    throw await toVoiceError(client, error, "lecture du salon");
  }
}

/**
 * Accès à la table, toute panne de base traduite en `VOICE_STORAGE_ERROR`.
 * @param query Requête paramétrée.
 * @param values Valeurs liées.
 * @returns Les lignes lues.
 */
async function db<T>(query: string, values: unknown[] = []): Promise<T[]> {
  try {
    return await (await getBddInstance()).raw<T>(query, values);
  } catch (error) {
    throw new VoiceChannelError("VOICE_STORAGE_ERROR", "stockage", error);
  }
}

/**
 * Ligne suivie d'un salon.
 * @param channelId Identifiant du salon.
 * @returns La ligne, ou `null` si le bot ne suit pas ce salon.
 */
async function trackedById(channelId: string): Promise<TrackedRow | null> {
  const rows = await db<TrackedRow>(
    "SELECT channel_id, voice_key, created_at, released_at FROM MatchVoiceChannel WHERE channel_id = ?",
    [channelId],
  );
  return rows[0] ?? null;
}

/**
 * Cesse de suivre un salon (supprimé, à la main ou par le bot).
 * @param channelId Identifiant du salon.
 */
async function untrack(channelId: string): Promise<void> {
  releasedIds.delete(channelId);
  await db("DELETE FROM MatchVoiceChannel WHERE channel_id = ?", [channelId]);
  forgetAliasesTo(channelId);
}

/**
 * Oublie les alias qui mènent à un salon que le bot cesse de suivre : ils ne désigneraient plus
 * rien, et la place reste aux alias vivants (`REPLACED_ALIAS_MAX`).
 * @param channelId Salon qui n'est plus suivi.
 */
function forgetAliasesTo(channelId: string): void {
  for (const [id, target] of replacedIds) {
    if (target === channelId) { replacedIds.delete(id); }
  }
}

/**
 * Supprime un salon suivi puis cesse de le suivre. Un salon déjà disparu est
 * seulement retiré du suivi ; tout autre refus le garde, pour le balayage
 * suivant.
 * @param client Client Discord.
 * @param channel Salon à supprimer.
 */
async function deleteTracked(client: Client, channel: VoiceHandle): Promise<void> {
  botDeletedIds.delete(channel.id);
  makeRoom(botDeletedIds, REPLACED_ALIAS_MAX);
  botDeletedIds.add(channel.id);
  try {
    await channel.delete(DELETE_REASON);
  } catch (error) {
    // Réponse de Discord (déjà disparu, refus) : aucun événement à attendre de notre fait,
    // l'identifiant n'est pas gardé. Sans réponse (réseau, délai dépassé), Discord a pu supprimer
    // le salon : l'identifiant reste, son événement ne doit pas le recréer.
    if (discordJsonCode(error) !== null) { botDeletedIds.delete(channel.id); }
    if (discordJsonCode(error) !== UNKNOWN_CHANNEL) {
      throw await toVoiceError(client, error, "suppression du salon");
    }
  }
  await untrack(channel.id);
}

/**
 * Exécute `task` après toute autre tâche de même clé.
 * @param key Clé d'idempotence.
 * @param task Tâche à exécuter.
 * @returns Le résultat de la tâche.
 */
async function withKeyLock<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = pendingByKey.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  pendingByKey.set(key, run);
  try {
    return await run;
  } finally {
    if (pendingByKey.get(key) === run) { pendingByKey.delete(key); }
  }
}

/**
 * Exécute `task` sous le verrou de la clé du salon, avec sa ligne relue sous
 * ce verrou : une reprise par le site (`ensureTeamVoiceChannel`), une
 * libération, un départ et le balayage ne se croisent jamais sur un même salon.
 * @param channelId Identifiant du salon.
 * @param task Tâche, appelée avec la ligne à jour (`null` : salon non suivi).
 * @returns Le résultat de la tâche.
 */
async function withChannelLock<T>(channelId: string, task: (row: TrackedRow | null) => Promise<T>): Promise<T> {
  const row = await trackedOrReplaced(channelId);
  if (!row) { return task(null); }
  // Relu sous le verrou, alias compris : une recréation tenue par ce verrou a pu remplacer le salon.
  return withKeyLock(row.voice_key, async () => task(await trackedOrReplaced(channelId)));
}

/**
 * Ligne suivie d'un identifiant, alias de recréation compris : celle du salon neuf, sinon
 * celle de l'identifiant reçu (une recréation en cours a déjà posé l'alias mais pas encore
 * déplacé la ligne — elle tient le verrou de la clé, que l'appelant attend alors).
 * @param channelId Identifiant reçu.
 * @returns La ligne, ou `null`.
 */
async function trackedOrReplaced(channelId: string): Promise<TrackedRow | null> {
  const current = currentChannelId(channelId);
  const row = await trackedById(current);
  if (row || current === channelId) { return row; }
  return trackedById(channelId);
}

/**
 * Identifiant actuel d'un salon : celui du salon neuf si la modération a supprimé celui-ci
 * et que le bot l'a recréé (le site garde l'ancien jusqu'à sa revérification suivante) ;
 * sinon l'identifiant tel quel. Les alias sont tenus à plat (`rememberReplacement`) : un
 * salon recréé plusieurs fois de suite mène en un pas au dernier.
 * @param channelId Identifiant reçu.
 * @returns L'identifiant à suivre.
 */
function currentChannelId(channelId: string): string {
  return replacedIds.get(channelId) ?? channelId;
}

/**
 * Retient qu'un salon a été remplacé : les alias qui menaient à l'ancien mènent désormais
 * au neuf ; la mémoire reste bornée (le plus ancien alias est oublié au-delà de
 * `REPLACED_ALIAS_MAX`).
 * @param from Ancien identifiant.
 * @param to Salon neuf.
 */
function rememberReplacement(from: string, to: string): void {
  // Réinsérés en fin de file : un alias encore vivant n'est pas le premier oublié.
  const chained = [...replacedIds].filter(([, target]) => target === from).map(([id]) => id);
  for (const id of chained) {
    replacedIds.delete(id);
    replacedIds.set(id, to);
  }
  replacedIds.delete(from);
  makeRoom(replacedIds, REPLACED_ALIAS_MAX);
  replacedIds.set(from, to);
}

/**
 * Crée le salon dans la catégorie et l'inscrit au suivi.
 * @param client Client Discord.
 * @param key Clé d'idempotence.
 * @param name Nom déjà nettoyé.
 * @param now Instant de création.
 * @returns L'identifiant du salon créé.
 */
async function createInCategory(client: Client, key: string, name: string, now: number): Promise<string> {
  return createAndStore(client, name, async (channelId) => {
    await db(
      "INSERT INTO MatchVoiceChannel (channel_id, voice_key, created_at, released_at) VALUES (?, ?, ?, NULL)",
      [channelId, key, now],
    );
  });
}

/**
 * Crée un salon vocal dans la catégorie, puis l'inscrit par `store` ; si l'inscription
 * échoue, le salon est retiré aussitôt (un salon que le bot ne suit pas ne serait jamais
 * supprimé).
 * @param client Client Discord.
 * @param name Nom déjà nettoyé.
 * @param store Inscription du salon créé au suivi.
 * @returns L'identifiant du salon créé.
 */
async function createAndStore(client: Client, name: string, store: (channelId: string) => Promise<void>): Promise<string> {
  const categoryId = voiceCategoryId();
  let category;
  try {
    category = await client.channels.fetch(categoryId);
  } catch (error) {
    if (discordJsonCode(error) === UNKNOWN_CHANNEL) {
      throw new VoiceChannelError("VOICE_CATEGORY_UNAVAILABLE", "catégorie introuvable", undefined, categoryId);
    }
    throw await toVoiceError(client, error, "lecture de la catégorie");
  }
  if (!category || category.type !== ChannelType.GuildCategory) {
    throw new VoiceChannelError("VOICE_CATEGORY_UNAVAILABLE", "catégorie introuvable", undefined, categoryId);
  }

  let channelId: string;
  try {
    // Sans `permissionOverwrites`, Discord aligne les permissions du salon sur la catégorie.
    const created = await category.guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      userLimit: VOICE_USER_LIMIT,
      reason: "Salon vocal d'équipe pour un match",
    });
    channelId = created.id;
  } catch (error) {
    throw await toVoiceError(client, error, "création du salon");
  }

  try {
    await store(channelId);
  } catch (error) {
    // Un salon que le bot ne suit pas ne serait jamais supprimé : on le retire aussitôt.
    const orphan = await fetchVoice(client, channelId).catch(() => null);
    await orphan?.delete(DELETE_REASON).catch(() => undefined);
    throw error;
  }
  return channelId;
}

/**
 * Rend le salon vocal d'une clé, créé au besoin (`POST /internal/voice/channels`).
 *
 * Même clé, même salon : un nouvel essai du site ou un redémarrage ne crée pas
 * de doublon. Un salon supprimé à la main est recréé. Un salon libéré mais
 * encore là est repris (option rallumée) : il n'est plus libéré.
 *
 * @param client Client Discord.
 * @param key Clé d'idempotence validée.
 * @param name Nom d'équipe nettoyé.
 * @param now Instant courant (ms), pour les tests.
 * @returns L'identifiant du salon et s'il vient d'être créé.
 */
export async function ensureTeamVoiceChannel(
  client: Client,
  key: string,
  name: string,
  now: number = Date.now(),
): Promise<{ channelId: string; created: boolean }> {
  return withKeyLock(key, async () => {
    const rows = await db<TrackedRow>(
      "SELECT channel_id, voice_key, created_at, released_at FROM MatchVoiceChannel WHERE voice_key = ?",
      [key],
    );
    const existing = rows[0];
    if (existing) {
      const channel = await fetchVoice(client, existing.channel_id);
      if (channel) {
        if (existing.released_at !== null) {
          // Repris : un nouveau délai de 48 h court, comme pour un salon neuf.
          await db("UPDATE MatchVoiceChannel SET released_at = NULL, created_at = ? WHERE channel_id = ?", [now, existing.channel_id]);
          releasedIds.delete(existing.channel_id);
        }
        return { channelId: existing.channel_id, created: false };
      }
      await untrack(existing.channel_id);
    }
    return { channelId: await createInCategory(client, key, name, now), created: true };
  });
}

/**
 * Libère un salon suivi (`POST …/release`) : supprimé tout de suite s'il est
 * vide, sinon dès que le dernier occupant le quitte.
 *
 * Un salon que le bot ne suit plus (déjà supprimé, par lui ou à la main, puis
 * oublié) est **déjà libéré** : la demande réussit sans toucher Discord — le bot
 * ne supprime jamais un salon qu'il ne suit pas — et le site ferme sa ligne
 * comme pour toute libération.
 *
 * `deleted` reste interne au bot : la route ne répond que `{ released: true }`,
 * jamais si le salon était vide (le site n'apprend rien de son occupation).
 * @param client Client Discord.
 * @param channelId Identifiant validé.
 * @param now Instant courant (ms), pour les tests.
 * @returns `deleted` (usage interne, jamais rendu au site) : le salon n'existe plus.
 */
export async function releaseVoiceChannel(
  client: Client,
  channelId: string,
  now: number = Date.now(),
): Promise<{ deleted: boolean }> {
  return withChannelLock(channelId, async (row) => (row ? releaseTrackedLocked(client, row.channel_id, now) : { deleted: true }));
}

/**
 * Vide un salon suivi (`POST …/clear`) : tous ses occupants sont déconnectés —
 * l'arbitrage (arbitres et administrateurs, D13) ou l'équipe pour son propre salon (D36) en écarte ainsi qui ne devrait pas s'y trouver, les salons
 * étant ouverts à qui voit la catégorie. Le salon reste ouvert (et suivi) ; rendu,
 * il se supprime dès qu'il se vide. Les occupants ne sont lus que pour être
 * déconnectés : ni identifiant, ni pseudo, ni nombre n'est gardé, journalisé ou
 * rendu au site. Un occupant parti entre-temps n'est pas une erreur ; un refus propre à un
 * occupant n'arrête pas les autres (levé une fois tous essayés), mais une permission manquante
 * ou un Discord saturé, en panne ou injoignable arrête la boucle (les suivants échoueraient de même).
 * @param client Client Discord.
 * @param channelId Identifiant validé.
 * @returns `false` si le bot ne suit pas ce salon (ou s'il n'existe plus, ou a quitté la catégorie) : rien n'est touché.
 */
export async function clearVoiceChannel(client: Client, channelId: string): Promise<boolean> {
  return withChannelLock(channelId, async (row) => {
    if (!row) { return false; }
    const channel = (await fetchVoice(client, row.channel_id)) as ClearableVoice | null;
    if (!channel) { return false; }
    let refusal: unknown = null;
    for (const occupant of [...channel.members.values()]) {
      try {
        await occupant.voice.disconnect(CLEAR_REASON);
      } catch (error) {
        const code = discordJsonCode(error);
        if (code === TARGET_NOT_IN_VOICE) { continue; }
        // Permission manquante (alerte au staff) ou Discord saturé, en panne, injoignable
        // (`discordUnavailable`) : les suivants échoueraient de même, on n'appelle plus.
        if (code === MISSING_PERMISSIONS || code === MISSING_ACCESS || discordUnavailable(error)) {
          refusal = error;
          break;
        }
        refusal ??= error;
      }
    }
    if (refusal !== null) { throw await toVoiceError(client, refusal, "déconnexion des membres"); }
    return true;
  });
}

/**
 * Libère un salon suivi, verrou de sa clé déjà tenu par l'appelant (`withKeyLock` n'est pas
 * réentrant) : marque la libération, supprime le salon s'il est vide ou disparu.
 * @param client Client Discord.
 * @param channelId Identifiant d'un salon suivi, lu sous le verrou.
 * @param now Instant courant (ms).
 * @returns `deleted` : le salon n'existe plus.
 */
async function releaseTrackedLocked(client: Client, channelId: string, now: number): Promise<{ deleted: boolean }> {
  await db(
    "UPDATE MatchVoiceChannel SET released_at = COALESCE(released_at, ?) WHERE channel_id = ?",
    [now, channelId],
  );
  releasedIds.add(channelId);
  const channel = await fetchVoice(client, channelId);
  if (!channel) {
    await untrack(channelId);
    return { deleted: true };
  }
  if (channel.members.size === 0) {
    await deleteTracked(client, channel);
    return { deleted: true };
  }
  return { deleted: false };
}

/**
 * Libère le salon d'une clé (`POST /internal/voice/keys/release`) : le site
 * n'en connaît pas l'identifiant quand sa demande de création a expiré (délai,
 * réponse illisible) alors que le bot a pu créer le salon. Une création en cours
 * pour cette clé est attendue ; une clé sans salon suivi est déjà libérée.
 * @param client Client Discord.
 * @param key Clé d'idempotence validée.
 * @param now Instant courant (ms), pour les tests.
 */
export async function releaseVoiceChannelByKey(client: Client, key: string, now: number = Date.now()): Promise<void> {
  // Lecture et libération sous un seul verrou : une reprise de la clé (salon recréé) ne peut
  // pas se glisser entre les deux et laisser le salon neuf non libéré.
  await withKeyLock(key, async () => {
    const rows = await db<TrackedRow>(
      "SELECT channel_id, voice_key, created_at, released_at FROM MatchVoiceChannel WHERE voice_key = ?",
      [key],
    );
    const row = rows[0];
    if (!row) { return; }
    await releaseTrackedLocked(client, row.channel_id, now);
  });
}

/**
 * `voiceStateUpdate` : un départ qui vide un salon libéré le supprime. Seuls
 * les salons libérés connus du module sont regardés — aucune requête en base
 * pour les autres mouvements vocaux. Ne lève jamais.
 * @param client Client Discord.
 * @param oldState État vocal avant le mouvement.
 */
export async function handleVoiceStateUpdate(client: Client, oldState: Pick<VoiceState, "channelId" | "channel">): Promise<void> {
  const channelId = oldState.channelId;
  if (!channelId || !releasedIds.has(channelId)) { return; }
  const channel = oldState.channel as unknown as VoiceHandle | null;
  if (!channel || channel.members.size > 0) { return; }
  try {
    await withChannelLock(channelId, async (row) => {
      // Relu sous le verrou : repris par le site entre-temps, ou de nouveau occupé.
      if (row === null) { return; }
      if (row.released_at === null) {
        releasedIds.delete(channelId);
        return;
      }
      if (channel.members.size > 0) { return; }
      // Déplacé hors de la catégorie entre-temps : plus le nôtre, oublié sans suppression.
      if (!inVoiceCategory(channel)) {
        await untrack(channelId);
        return;
      }
      await deleteTracked(client, channel);
    });
  } catch (error) {
    await logVoiceFailure(client, error, `Salon vocal de match ${channelId} : suppression reportée au balayage (${voiceErrorDetail(error)}).`, "event");
  }
}

/**
 * `channelDelete` : un salon suivi supprimé à la main (modération) est **recréé aussitôt**
 * sous la même clé s'il n'était pas libéré — le match peut encore se jouer (décision D97 :
 * le site ne le revérifie plus que toutes les 5 minutes) ; libéré, il cesse d'être suivi — de
 * même s'il a passé 48 h sans être rendu ou si sa clé a déjà été recréée `RECREATE_MAX` fois en
 * 10 minutes (`mayRecreate` : aucune boucle suppression/recréation).
 * Un salon que le bot a supprimé lui-même n'est plus suivi quand l'événement arrive (sa
 * suppression et son retrait du suivi se font sous le verrou de la clé) : rien n'est recréé.
 * Seul un salon vocal de la catégorie est regardé — aucune lecture en base pour les salons
 * des serveurs partenaires ; un salon suivi sorti de la catégorie avant sa suppression est
 * oublié au balayage suivant. Une recréation en échec retire le salon du suivi : la
 * revérification suivante du site en rouvre un. Ne lève jamais.
 * @param client Client Discord.
 * @param channel Salon supprimé (son nom sert au salon neuf).
 * @param now Instant courant (ms), pour les tests.
 */
export async function handleVoiceChannelDeleted(
  client: Client,
  channel: { id: string; type?: ChannelType; parentId?: string | null; name?: string | null },
  now: number = Date.now(),
): Promise<void> {
  if (channel.type !== ChannelType.GuildVoice || channel.parentId !== voiceCategoryId()) { return; }
  const channelId = channel.id;
  // Supprimé par le bot lui-même : jamais recréé, même si son retrait du suivi a échoué
  // (le balayage suivant l'oublie).
  const byBot = botDeletedIds.delete(channelId);
  let step = "lecture du suivi";
  try {
    await withChannelLock(channelId, async (row) => {
      // Relu sous le verrou : supprimé par le bot (déjà retiré du suivi), ou libéré.
      if (row?.channel_id !== channelId) { return; }
      if (byBot || row.released_at !== null || !mayRecreate(row, now)) {
        step = "retrait du suivi";
        await untrack(channelId);
        return;
      }
      step = "recréation";
      await recreateDeleted(client, row, channel.name, now);
    });
  } catch (error) {
    await logVoiceFailure(client, error, `channelDelete (${step}) : salon vocal ${channelId} en échec (${voiceErrorDetail(error)}).`, "event");
  }
}

/**
 * Un salon supprimé par la modération peut-il être recréé ? Non s'il a passé le délai d'un salon
 * jamais rendu (`UNRELEASED_MAX_AGE_MS` : le site l'a perdu de vue, il serait supprimé vide de
 * toute façon), ni si sa clé a déjà été recréée `RECREATE_MAX` fois dans `RECREATE_WINDOW_MS`
 * (suppressions en boucle). Une recréation permise est comptée.
 * @param row Ligne du salon supprimé.
 * @param now Instant courant (ms).
 * @returns `true` s'il faut le recréer.
 */
function mayRecreate(row: TrackedRow, now: number): boolean {
  if (now - Number(row.created_at) > UNRELEASED_MAX_AGE_MS) { return false; }
  const recent = (recreatedAt.get(row.voice_key) ?? []).filter((at) => now - at < RECREATE_WINDOW_MS);
  recreatedAt.delete(row.voice_key);
  if (recent.length >= RECREATE_MAX) {
    recreatedAt.set(row.voice_key, recent);
    return false;
  }
  makeRoom(recreatedAt, REPLACED_ALIAS_MAX);
  recreatedAt.set(row.voice_key, [...recent, now]);
  return true;
}

/**
 * Recrée le salon d'une ligne suivie et pas libérée, supprimé par la modération : le nom qu'il
 * portait (nettoyé ; un renommage par la modération est gardé — le bot ne garde aucun nom
 * d'équipe), même clé, même catégorie ; la ligne suit le salon neuf (nouveau délai de 48 h,
 * comme une reprise par le site) et l'ancien identifiant le désigne encore (`rememberReplacement`).
 * Verrou de la clé tenu par l'appelant. En cas d'échec, l'ancien salon est retiré du suivi
 * puis l'erreur remonte.
 * @param client Client Discord.
 * @param row Ligne du salon supprimé.
 * @param deletedName Nom du salon supprimé.
 * @param now Instant courant (ms).
 */
async function recreateDeleted(client: Client, row: TrackedRow, deletedName: string | null | undefined, now: number): Promise<void> {
  const cleaned = cleanVoiceChannelName(deletedName);
  const name = cleaned || voiceChannelName(row.voice_key, FALLBACK_VOICE_NAME, true);
  let createdId: string | null = null;
  try {
    await createAndStore(client, name, async (id) => {
      createdId = id;
      // Alias posé avant de déplacer la ligne : une demande par l'ancien identifiant qui la lit
      // entre les deux attend ce verrou, puis relit la ligne par l'alias (`trackedOrReplaced`).
      rememberReplacement(row.channel_id, id);
      await db("UPDATE MatchVoiceChannel SET channel_id = ?, created_at = ? WHERE channel_id = ?", [id, now, row.channel_id]);
    });
  } catch (error) {
    if (createdId !== null && replacedIds.get(row.channel_id) === createdId) { replacedIds.delete(row.channel_id); }
    await untrack(row.channel_id).catch(() => undefined);
    throw error;
  }
}

/**
 * Décide du sort d'un salon suivi au balayage.
 * @param row Ligne suivie.
 * @param members Effectif du salon.
 * @param now Instant courant (ms).
 * @returns `true` s'il faut le supprimer.
 */
export function shouldSweep(row: Pick<TrackedRow, "created_at" | "released_at">, members: number, now: number): boolean {
  if (row.released_at !== null) {
    return members === 0 || now - Number(row.released_at) > RELEASED_MAX_AGE_MS;
  }
  // Jamais libéré : le match peut encore se jouer. Un salon occupé n'est jamais supprimé.
  return members === 0 && now - Number(row.created_at) > UNRELEASED_MAX_AGE_MS;
}

/**
 * Traite un salon suivi au balayage.
 * @param client Client Discord.
 * @param row Ligne suivie.
 * @param now Instant courant (ms).
 * @returns Le sort du salon.
 */
async function sweepOne(client: Client, row: TrackedRow, now: number): Promise<keyof SweepReport> {
  let channel: VoiceHandle | null;
  try {
    channel = await fetchVoice(client, row.channel_id);
  } catch (error) {
    // Salon que le bot ne voit plus (permission retirée, serveur quitté) depuis
    // longtemps : il ne pourra pas le supprimer, et le garder relancerait
    // l'alerte toutes les heures. Il est oublié.
    if (error instanceof VoiceChannelError && error.code === "VOICE_MISSING_PERMISSIONS"
      && now - Number(row.created_at) > ABANDONED_MAX_AGE_MS) {
      await untrack(row.channel_id);
      return "untracked";
    }
    throw error;
  }
  if (!channel) {
    await untrack(row.channel_id);
    return "untracked";
  }
  if (shouldSweep(row, channel.members.size, now)) {
    await deleteTracked(client, channel);
    return "deleted";
  }
  if (row.released_at === null) {
    releasedIds.delete(row.channel_id);
  } else {
    releasedIds.add(row.channel_id);
  }
  return "kept";
}

/**
 * Balayage des salons suivis, au démarrage et toutes les 30 min : supprime
 * les libérés vides, les libérés depuis plus de 24 h même occupés, et les
 * jamais libérés de plus de 48 h s'ils sont vides ; oublie ceux supprimés ou
 * sortis de la catégorie à la main, et ceux
 * que le bot ne voit plus depuis plus de 96 h. Tient à jour le cache des
 * salons libérés (rempli au démarrage). Ne lève jamais ; journalise un bilan s'il y a
 * eu quelque chose à faire.
 * @param client Client Discord.
 * @param now Instant courant (ms), pour les tests.
 * @returns Le bilan du balayage.
 */
export async function sweepVoiceChannels(client: Client, now: number = Date.now()): Promise<SweepReport> {
  const report: SweepReport = { deleted: 0, untracked: 0, kept: 0, failed: 0 };
  let rows: TrackedRow[];
  try {
    rows = await db<TrackedRow>("SELECT channel_id, voice_key, created_at, released_at FROM MatchVoiceChannel");
  } catch (error) {
    await sendLog(client, `Balayage des salons vocaux de match impossible : ${voiceErrorDetail(error)}`);
    return report;
  }
  for (const snapshot of rows) {
    try {
      // Relu sous le verrou de sa clé : la photo du début du balayage a pu
      // vieillir (salon repris, libéré ou supprimé entre-temps).
      const outcome = await withKeyLock(snapshot.voice_key, async () => {
        const row = await trackedById(snapshot.channel_id);
        return row ? sweepOne(client, row, now) : null;
      });
      if (outcome) { report[outcome]++; }
    } catch {
      // Gardé pour le balayage suivant ; toujours libérable par un départ.
      if (snapshot.released_at !== null) { releasedIds.add(snapshot.channel_id); }
      report.failed++;
    }
  }
  if (report.deleted + report.untracked + report.failed > 0) {
    await sendLog(
      client,
      `Salons vocaux de match : ${report.deleted} supprimé(s), ${report.untracked} disparu(s), ` +
        `${report.failed} en échec, ${report.kept} conservé(s).`,
    );
  }
  return report;
}
