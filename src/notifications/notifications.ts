/**
 * Messages automatisés poussés par l'app web (`appbluegenji`).
 *
 * Le bot ne décide de rien ici : il **distribue**. L'app connaît le domaine
 * (tournois, matchs, équipes, inscrits) et rédige le texte ; le bot sait à quel
 * compte Discord l'écrire et quels arbitres alerter. Le sens des appels reste
 * app → bot, comme pour l'auth, les logs et la fréquentation du site.
 *
 * Ce module est **pur** : il valide et normalise les corps reçus, sans toucher
 * ni à Discord ni à la base. La distribution vit dans `deliver.ts`.
 */

/** Destinataire d'un message privé, tel que l'app le connaît. */
export interface DirectMessageRecipient {
  /** Discord ID quand l'app le connaît (compte lié par code Discord). */
  discordId: string | null;
  /** Tag Discord (`pseudo`, ou legacy `pseudo#1234`) à résoudre à défaut d'ID. */
  handle: string | null;
  /** Libellé lisible pour les rapports d'échec (pseudo du site). */
  label: string;
}

/** Corps normalisé de `POST /internal/notify/dm`. */
export interface DirectMessageRequest {
  message: string;
  recipients: DirectMessageRecipient[];
  /** Étiquette libre journalisée avec l'envoi (`match-reminder`, …). */
  context: string;
}

/** Corps normalisé de `POST /internal/notify/referees`. */
export interface RefereeAlertRequest {
  message: string;
  context: string;
}

/**
 * Plafond de longueur d'un message privé.
 *
 * Discord coupe à 2000 caractères ; on tronque plus tôt pour laisser la place à
 * la mention de troncature sans jamais risquer un envoi refusé en bloc.
 */
export const MAX_MESSAGE_LENGTH = 1800;

/**
 * Plafond de destinataires par appel. Une équipe compte une poignée de joueurs,
 * un match deux équipes : au-delà de cent, c'est une erreur de l'appelant, pas
 * un rappel de match — et cent DM sont déjà une longue file côté Discord.
 */
export const MAX_RECIPIENTS = 100;

/** Un ID Discord (snowflake) tel que l'app peut en transmettre. */
const DISCORD_ID_RE = /^\d{5,32}$/;

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") { return null; }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Tronque un message trop long en le signalant.
 *
 * Tronquer plutôt que refuser : un rappel légèrement trop long doit partir
 * amputé, pas se perdre — le joueur a besoin de l'heure de son match, pas de
 * l'intégralité de la description du tournoi.
 *
 * @param message Message brut.
 * @returns Message borné à `MAX_MESSAGE_LENGTH` caractères.
 */
export function truncateMessage(message: string): string {
  if (message.length <= MAX_MESSAGE_LENGTH) { return message; }
  const suffix = "\n… (message tronqué)";
  return message.slice(0, MAX_MESSAGE_LENGTH - suffix.length) + suffix;
}

/**
 * Dédoublonne une liste de destinataires.
 *
 * Un joueur peut apparaître deux fois (deux équipes d'un même match, une équipe
 * et son coach) : sans ce filtre, il recevrait le même rappel en double. L'ID
 * prime sur le tag, seule identité fiable ; à défaut, le tag est comparé en
 * minuscules — les usernames Discord ne sont pas sensibles à la casse.
 *
 * @param recipients Destinataires bruts, dans l'ordre d'arrivée.
 * @returns Les mêmes, sans doublon, dans l'ordre d'arrivée.
 */
export function dedupeRecipients(recipients: DirectMessageRecipient[]): DirectMessageRecipient[] {
  const seen = new Set<string>();
  const unique: DirectMessageRecipient[] = [];
  for (const recipient of recipients) {
    const key = recipient.discordId
      ? `id:${recipient.discordId}`
      : `tag:${(recipient.handle ?? "").toLowerCase()}`;
    if (seen.has(key)) { continue; }
    seen.add(key);
    unique.push(recipient);
  }
  return unique;
}

function parseRecipient(raw: unknown): DirectMessageRecipient | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) { return null; }
  const record = raw as Record<string, unknown>;

  const rawId = toTrimmedString(record.discordId);
  const discordId = rawId !== null && DISCORD_ID_RE.test(rawId) ? rawId : null;
  const handle = toTrimmedString(record.handle);

  // Sans ID valide **ni** tag, il n'y a personne à joindre : le destinataire est
  // écarté ici plutôt que compté comme un échec d'envoi plus loin.
  if (discordId === null && handle === null) { return null; }

  return {
    discordId,
    handle,
    label: toTrimmedString(record.label) ?? handle ?? discordId ?? "inconnu",
  };
}

/**
 * Valide un corps de `POST /internal/notify/dm`.
 *
 * @param payload Corps JSON reçu.
 * @returns La demande normalisée, ou `null` si elle est inexploitable (message
 *          vide, aucun destinataire joignable).
 */
export function parseDirectMessageRequest(payload: unknown): DirectMessageRequest | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) { return null; }
  const raw = payload as Record<string, unknown>;

  const message = toTrimmedString(raw.message);
  if (message === null) { return null; }

  if (!Array.isArray(raw.recipients)) { return null; }
  const recipients = dedupeRecipients(
    raw.recipients
      .map(parseRecipient)
      .filter((recipient): recipient is DirectMessageRecipient => recipient !== null),
  ).slice(0, MAX_RECIPIENTS);
  if (recipients.length === 0) { return null; }

  return {
    message: truncateMessage(message),
    recipients,
    context: toTrimmedString(raw.context) ?? "site",
  };
}

/**
 * Valide un corps de `POST /internal/notify/referees`.
 *
 * @param payload Corps JSON reçu.
 * @returns La demande normalisée, ou `null` si le message est vide.
 */
export function parseRefereeAlert(payload: unknown): RefereeAlertRequest | null {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) { return null; }
  const raw = payload as Record<string, unknown>;

  const message = toTrimmedString(raw.message);
  if (message === null) { return null; }

  return {
    message: truncateMessage(message),
    context: toTrimmedString(raw.context) ?? "site",
  };
}
