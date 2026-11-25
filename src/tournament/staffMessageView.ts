/**
 * Textes et composants de `/message-tournoi`, en français ou en anglais selon
 * la langue du client Discord de l'auteur (`interaction.locale` : anglais pour
 * une langue `en-*`, français sinon). Module pur : rien n'y touche Discord.
 *
 * Aucun nom ni identifiant de destinataire n'y paraît : le site ne rend que des
 * nombres. Le nom du tournoi et le texte du staff sont échappés (balisage et
 * mentions neutralisés), le texte cité ligne à ligne.
 */

import { ButtonStyle, ComponentType, type APIActionRowComponent, type APIComponentInMessageActionRow } from "discord.js";
import { escapeDiscord, quoteBlock } from "../internalApi/sancturai.js";
import { cutText } from "../utils/cutText.js";
import {
  SITE_BAD_RESPONSE,
  SITE_NOT_CONFIGURED,
  SITE_TIMEOUT,
  SITE_UNREACHABLE,
  STAFF_MESSAGE_CATEGORIES,
  type RecipientCounts,
  type StaffMessageCategory,
  type StaffMessagePreview,
  type StaffMessageSent,
} from "./siteStaffMessage.js";

export type Lang = "fr" | "en";

/** Durée de vie du panneau d'aperçu (menu et boutons). */
export const PANEL_LIFETIME_MS = 5 * 60_000;

/** Préfixe des identifiants de composants, suivi de l'identifiant de l'interaction d'origine. */
const CUSTOM_ID_PREFIX = "staffmsg";

/** Longueur maximale d'un message Discord. */
const DISCORD_MAX = 2000;

/** Place laissée à la citation du texte dans l'aperçu (le reste : en-tête et comptes). */
const PREVIEW_QUOTE_MAX = 1500;

/**
 * @param locale Langue du client Discord (`interaction.locale`).
 * @returns `en` pour une langue anglaise, `fr` sinon (langue du bot).
 */
export function langOf(locale: string | null | undefined): Lang {
  return typeof locale === "string" && locale.toLowerCase().startsWith("en") ? "en" : "fr";
}

/** Identifiants des trois composants d'un panneau. */
export function customIds(nonce: string): { select: string; send: string; cancel: string } {
  return {
    select: `${CUSTOM_ID_PREFIX}:select:${nonce}`,
    send: `${CUSTOM_ID_PREFIX}:send:${nonce}`,
    cancel: `${CUSTOM_ID_PREFIX}:cancel:${nonce}`,
  };
}

const CATEGORY_LABELS: Record<Lang, Record<StaffMessageCategory, { label: string; description: string }>> = {
  fr: {
    PLAYERS: { label: "Joueurs", description: "Membres TANK, DPS ou HEAL, et joueurs d'un tournoi individuel" },
    MANAGERS: { label: "Managers", description: "Membres MANAGER des équipes inscrites" },
    CAPTAINS: { label: "Capitaines", description: "Membres CAPITAINE des équipes inscrites" },
    OWNERS: { label: "Owners", description: "Propriétaires (OWNER) des équipes inscrites" },
    ALL: { label: "Tous", description: "Tous les participants, quoi qu'on coche d'autre" },
  },
  en: {
    PLAYERS: { label: "Players", description: "TANK, DPS or HEAL members, and players of a solo tournament" },
    MANAGERS: { label: "Managers", description: "MANAGER members of the registered teams" },
    CAPTAINS: { label: "Captains", description: "CAPTAIN members of the registered teams" },
    OWNERS: { label: "Owners", description: "Owners (OWNER) of the registered teams" },
    ALL: { label: "Everyone", description: "All participants, whatever else is ticked" },
  },
};

const TEXT = {
  fr: {
    placeholder: "Destinataires",
    send: "Envoyer",
    cancel: "Annuler",
    header: (name: string, id: number) => `📣 **Message aux participants de ${name}** (tournoi n° ${id})`,
    recipients: (c: RecipientCounts) =>
      `**Destinataires : ${c.total}** — ${c.reachable} en message privé, ${c.withoutDiscord} sans Discord rattaché (notification push seulement), ${c.optedOut} ont coupé ces messages.`,
    howTo: (expiresAt: number) => `Choisis les destinataires, puis **Envoyer**. Ce panneau expire <t:${expiresAt}:R>.`,
    none: "Personne à prévenir pour cette sélection.",
    sending: "⏳ Envoi en cours… Le bilan s'affichera ici.",
    sent: (name: string, d: StaffMessageSent["delivery"]) =>
      `✅ Message envoyé aux participants de ${name} : ${d.sent} message(s) privé(s) remis, ${d.failed} non remis, ${d.skipped} sans message privé (messages coupés ou sans Discord), ${d.pushed} notification(s) push.`,
    botUnreachable: "⚠️ Le site n'a pas pu confirmer les messages privés : le bot ne lui a pas répondu.",
    cancelled: "Envoi annulé : rien n'est parti.",
    expired: "Aperçu expiré : rien n'est parti. Relance la commande pour écrire aux participants.",
    notAuthor: "Seul l'auteur de la commande peut utiliser ce panneau.",
    badReference: "Tournoi non reconnu : donne son numéro ou le lien de sa fiche sur le site.",
    failed: "Une erreur est survenue : rien n'est parti.",
  },
  en: {
    placeholder: "Recipients",
    send: "Send",
    cancel: "Cancel",
    header: (name: string, id: number) => `📣 **Message to the participants of ${name}** (tournament #${id})`,
    recipients: (c: RecipientCounts) =>
      `**Recipients: ${c.total}** — ${c.reachable} by direct message, ${c.withoutDiscord} without a linked Discord (push notification only), ${c.optedOut} turned these messages off.`,
    howTo: (expiresAt: number) => `Pick the recipients, then **Send**. This panel expires <t:${expiresAt}:R>.`,
    none: "Nobody to notify for this selection.",
    sending: "⏳ Sending… The summary will show here.",
    sent: (name: string, d: StaffMessageSent["delivery"]) =>
      `✅ Message sent to the participants of ${name}: ${d.sent} direct message(s) delivered, ${d.failed} not delivered, ${d.skipped} without a direct message (turned off or no Discord), ${d.pushed} push notification(s).`,
    botUnreachable: "⚠️ The site could not confirm the direct messages: the bot did not answer it.",
    cancelled: "Sending cancelled: nothing was sent.",
    expired: "Preview expired: nothing was sent. Run the command again to write to the participants.",
    notAuthor: "Only the author of the command can use this panel.",
    badReference: "Tournament not recognised: give its number or the link to its page on the site.",
    failed: "Something went wrong: nothing was sent.",
  },
} as const;

/** Explication d'un refus, par code (du site, ou du bot pour un site muet). */
const REFUSALS: Record<Lang, Record<string, string>> = {
  fr: {
    DISCORD_ACCOUNT_NOT_LINKED: "Ton compte Discord n'est rattaché à aucun compte du site BlueGenji.",
    FORBIDDEN: "Commande réservée au staff des tournois du site BlueGenji.",
    TOURNAMENT_NOT_FOUND: "Tournoi introuvable sur le site.",
    TOURNAMENT_NOT_OPEN_FOR_MESSAGES: "Ce tournoi n'accepte pas de message : seulement pendant ses inscriptions ou quand il est en cours.",
    NO_RECIPIENTS: "Personne à prévenir pour cette sélection : rien n'est parti.",
    STAFF_MESSAGE_QUOTA_EXCEEDED: "Limite atteinte pour ce tournoi (3 messages par heure) : réessaie plus tard.",
    STAFF_MESSAGE_EMPTY: "Le message est vide.",
    STAFF_MESSAGE_TOO_LONG: "Le message est trop long une fois mis en forme : raccourcis-le.",
    TOO_MANY_REQUESTS: "Trop de demandes : réessaie dans quelques minutes.",
    STAFF_MESSAGE_UNAVAILABLE: "L'envoi est indisponible sur le site pour le moment.",
    [SITE_UNREACHABLE]: "Site BlueGenji injoignable : réessaie plus tard.",
    [SITE_TIMEOUT]: "Le site BlueGenji n'a pas répondu à temps : réessaie plus tard.",
    [SITE_BAD_RESPONSE]: "Réponse illisible du site BlueGenji : réessaie plus tard.",
    [SITE_NOT_CONFIGURED]: "La commande n'est pas configurée sur ce bot (adresse ou jeton du site).",
  },
  en: {
    DISCORD_ACCOUNT_NOT_LINKED: "Your Discord account is not linked to any BlueGenji site account.",
    FORBIDDEN: "This command is reserved for the BlueGenji site's tournament staff.",
    TOURNAMENT_NOT_FOUND: "Tournament not found on the site.",
    TOURNAMENT_NOT_OPEN_FOR_MESSAGES: "This tournament does not accept messages: only during its registration or while it is running.",
    NO_RECIPIENTS: "Nobody to notify for this selection: nothing was sent.",
    STAFF_MESSAGE_QUOTA_EXCEEDED: "Limit reached for this tournament (3 messages per hour): try again later.",
    STAFF_MESSAGE_EMPTY: "The message is empty.",
    STAFF_MESSAGE_TOO_LONG: "The message is too long once formatted: shorten it.",
    TOO_MANY_REQUESTS: "Too many requests: try again in a few minutes.",
    STAFF_MESSAGE_UNAVAILABLE: "Sending is unavailable on the site for now.",
    [SITE_UNREACHABLE]: "BlueGenji site unreachable: try again later.",
    [SITE_TIMEOUT]: "The BlueGenji site did not answer in time: try again later.",
    [SITE_BAD_RESPONSE]: "Unreadable answer from the BlueGenji site: try again later.",
    [SITE_NOT_CONFIGURED]: "The command is not configured on this bot (site address or token).",
  },
};

/** Un envoi dont le site n'a pas rendu le bilan à temps a pu partir : on le dit. */
const SEND_TIMEOUT_TEXT: Record<Lang, string> = {
  fr: "⚠️ Le site n'a pas confirmé l'envoi à temps : il peut être encore en cours. Ne le relance pas tout de suite, le journal du staff en gardera la trace.",
  en: "⚠️ The site did not confirm the sending in time: it may still be in progress. Do not run it again right away; the staff log will keep a trace of it.",
};

/**
 * @param code Code du refus.
 * @param lang Langue de la réponse.
 * @param sending `true` pour un refus rendu à l'envoi (un délai dépassé y veut dire « peut-être parti »).
 * @returns Le texte à montrer à l'auteur.
 */
export function refusalText(code: string, lang: Lang, sending = false): string {
  if (sending && code === SITE_TIMEOUT) { return SEND_TIMEOUT_TEXT[lang]; }
  const known = REFUSALS[lang][code];
  if (known) { return `❌ ${known}`; }
  return lang === "en" ? `❌ The site refused the request (${code}).` : `❌ Le site a refusé la demande (${code}).`;
}

/** Textes fixes (annulé, expiré, pas l'auteur…). */
export function fixedText(key: "sending" | "cancelled" | "expired" | "notAuthor" | "badReference" | "failed", lang: Lang): string {
  return TEXT[lang][key];
}

/** Ce qu'un panneau peut encore envoyer : le site a-t-il quelqu'un à prévenir ? */
export function hasRecipients(counts: RecipientCounts): boolean {
  return counts.reachable + counts.withoutDiscord > 0;
}

type PanelView = { content: string; components: APIActionRowComponent<APIComponentInMessageActionRow>[] };

/**
 * Le panneau d'aperçu : tournoi, texte tel qu'il sera cité, comptes, menu des
 * destinataires (1 à 5, `Tous` par défaut) et boutons.
 * @param input Aperçu du site, texte du staff, catégories cochées, échéance (secondes Unix), langue et nonce.
 * @returns Le contenu et les composants du message éphémère.
 */
export function previewPanel(input: {
  preview: StaffMessagePreview;
  message: string;
  categories: readonly StaffMessageCategory[];
  expiresAt: number;
  lang: Lang;
  nonce: string;
}): PanelView {
  const text = TEXT[input.lang];
  const ids = customIds(input.nonce);
  const name = escapeDiscord(cutText(input.preview.tournament.name, 120));
  const counts = input.preview.recipients;
  const lines = [
    text.header(name, input.preview.tournament.id),
    cutText(quoteBlock(input.message), PREVIEW_QUOTE_MAX),
    "",
    text.recipients(counts),
    hasRecipients(counts) ? text.howTo(input.expiresAt) : text.none,
  ];
  const content = cutText(lines.join("\n"), DISCORD_MAX);
  const selected = new Set(input.categories);
  return {
    content,
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: ids.select,
            placeholder: text.placeholder,
            min_values: 1,
            max_values: STAFF_MESSAGE_CATEGORIES.length,
            options: STAFF_MESSAGE_CATEGORIES.map((category) => ({
              value: category,
              label: CATEGORY_LABELS[input.lang][category].label,
              description: CATEGORY_LABELS[input.lang][category].description,
              default: selected.has(category),
            })),
          },
        ],
      },
      {
        type: ComponentType.ActionRow,
        components: [
          { type: ComponentType.Button, custom_id: ids.send, label: text.send, style: ButtonStyle.Success, disabled: !hasRecipients(counts) },
          { type: ComponentType.Button, custom_id: ids.cancel, label: text.cancel, style: ButtonStyle.Secondary },
        ],
      },
    ],
  };
}

/**
 * Le bilan d'un envoi : des nombres, jamais un nom.
 * @param result Bilan du site.
 * @param lang Langue de la réponse.
 * @returns Le texte à montrer à l'auteur.
 */
export function sentText(result: StaffMessageSent, lang: Lang): string {
  const name = escapeDiscord(cutText(result.tournament.name, 120));
  const lines = [TEXT[lang].sent(name, result.delivery)];
  if (result.delivery.botUnreachable) { lines.push(TEXT[lang].botUnreachable); }
  return lines.join("\n");
}
