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
  SITE_OUTCOME_UNKNOWN,
  SITE_TIMEOUT,
  SITE_UNREACHABLE,
  STAFF_MESSAGE_CATEGORIES,
  STAFF_MESSAGE_SENDS_PER_WINDOW,
  type RecipientCounts,
  type StaffMessageCategory,
  type StaffMessagePreview,
  type StaffMessageSent,
} from "./siteStaffMessage.js";

export type Lang = "fr" | "en";

/** Singulier ou pluriel : en français 0 et 1 sont singuliers, en anglais seul 1. */
function plural(lang: Lang, n: number, one: string, many: string): string {
  const singular = lang === "fr" ? n <= 1 : n === 1;
  return singular ? one : many;
}

/** Durée de vie du panneau d'aperçu (menu et boutons). */
export const PANEL_LIFETIME_MS = 5 * 60_000;

/** Préfixe des identifiants de composants, suivi de l'identifiant de l'interaction d'origine. */
const CUSTOM_ID_PREFIX = "staffmsg";

/** Longueur maximale d'un message Discord. */
const DISCORD_MAX = 2000;

/** Marque d'une citation raccourcie dans l'aperçu (le message part, lui, en entier). */
const PREVIEW_CUT_MARK = {
  fr: "> *(aperçu raccourci : le message part en entier)*",
  en: "> *(preview shortened: the full message is sent)*",
} as const;

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
    OWNERS: { label: "Propriétaires", description: "Propriétaires (OWNER) des équipes inscrites" },
    ALL: { label: "Tous", description: "Tous les participants ; en cocher d'autres retire « Tous »" },
  },
  en: {
    PLAYERS: { label: "Players", description: "TANK, DPS or HEAL members, and players of a solo tournament" },
    MANAGERS: { label: "Managers", description: "MANAGER members of the registered teams" },
    CAPTAINS: { label: "Captains", description: "CAPTAIN members of the registered teams" },
    OWNERS: { label: "Owners", description: "Owners (OWNER) of the registered teams" },
    ALL: { label: "Everyone", description: "All participants; ticking others removes “Everyone”" },
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
      `✅ Message envoyé aux participants de ${name} : ${d.sent} ${plural("fr", d.sent, "message privé remis", "messages privés remis")}, ${d.failed} non remis, ${d.skipped} sans message privé (messages coupés ou sans Discord), ${d.pushed} ${plural("fr", d.pushed, "notification push", "notifications push")}.`,
    nothingDelivered: "⚠️ Aucun message n'a été remis : le bot Discord était injoignable et aucune notification push n'est partie. L'envoi ne compte pas dans ta limite : réessaie plus tard.",
    nobodyReached: "⚠️ Aucun participant n'a pu être joint : messages privés fermés ou introuvables, aucun appareil en push. L'envoi ne compte pas dans ta limite, mais le relancer n'y changerait rien.",
    botUnreachable: "⚠️ Le site n'a pas pu confirmer les messages privés : le bot ne lui a pas répondu.",
    sendingOn: (name: string) =>
      `⏳ Le message part aux participants de ${name} : l'envoi continue sur le site. Ne le relance pas ; le bilan sera noté au journal du staff.`,
    unconfirmed: (n: number) =>
      `⚠️ ${n} ${plural("fr", n, "message privé sans bilan du bot", "messages privés sans bilan du bot")} : peut-être remis. Ne le relance pas ; vérifie le journal du staff.`,
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
      `✅ Message sent to the participants of ${name}: ${d.sent} ${plural("en", d.sent, "direct message delivered", "direct messages delivered")}, ${d.failed} not delivered, ${d.skipped} without a direct message (turned off or no Discord), ${d.pushed} ${plural("en", d.pushed, "push notification", "push notifications")}.`,
    nothingDelivered: "⚠️ No message was delivered: the Discord bot was unreachable and no push notification went out. The sending does not count towards your limit: try again later.",
    nobodyReached: "⚠️ No participant could be reached: direct messages closed or not found, no push device. The sending does not count towards your limit, but running it again would not change anything.",
    botUnreachable: "⚠️ The site could not confirm the direct messages: the bot did not answer it.",
    sendingOn: (name: string) =>
      `⏳ The message is going out to the participants of ${name}: sending is still going on on the site. Do not run it again; the summary will be noted in the staff log.`,
    unconfirmed: (n: number) =>
      `⚠️ ${n} ${plural("en", n, "direct message", "direct messages")} without the bot's report: maybe delivered. Do not run it again; check the staff log.`,
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
    STAFF_MESSAGE_QUOTA_EXCEEDED: `Tu as atteint ta limite pour ce tournoi (${STAFF_MESSAGE_SENDS_PER_WINDOW} messages par heure et par membre du staff) : réessaie plus tard.`,
    STAFF_MESSAGE_EMPTY: "Le message est vide.",
    STAFF_MESSAGE_TOO_LONG: "Le message est trop long une fois mis en forme : raccourcis-le.",
    TOO_MANY_REQUESTS: "Trop de demandes : réessaie dans quelques minutes.",
    STAFF_MESSAGE_UNAVAILABLE: "L'envoi est indisponible sur le site pour le moment.",
    INTERNAL_ERROR: "Le site BlueGenji a rencontré une erreur : réessaie dans un instant.",
    CONCURRENT_UPDATE_RETRY: "Le site BlueGenji était occupé : réessaie dans un instant.",
    UNAUTHORIZED: "La commande est mal configurée sur ce bot (jeton du site refusé).",
    SITE_INTERNAL_TOKEN_NOT_CONFIGURED: "La commande n'est pas configurée sur le site (jeton absent).",
    PAYLOAD_TOO_LARGE: "Le message est trop long : raccourcis-le.",
    INVALID_STAFF_MESSAGE_REQUEST: "Le site a jugé la demande invalide : relance la commande.",
    INVALID_RECIPIENT_CATEGORIES: "Catégorie de destinataires invalide : relance la commande.",
    INVALID_TOURNAMENT_ID: "Numéro de tournoi invalide : donne son numéro ou le lien de sa fiche sur le site.",
    INVALID_DISCORD_ID: "Ton identifiant Discord n'a pas été reconnu : relance la commande.",
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
    STAFF_MESSAGE_QUOTA_EXCEEDED: `You reached your limit for this tournament (${STAFF_MESSAGE_SENDS_PER_WINDOW} messages per hour per staff member): try again later.`,
    STAFF_MESSAGE_EMPTY: "The message is empty.",
    STAFF_MESSAGE_TOO_LONG: "The message is too long once formatted: shorten it.",
    TOO_MANY_REQUESTS: "Too many requests: try again in a few minutes.",
    STAFF_MESSAGE_UNAVAILABLE: "Sending is unavailable on the site for now.",
    INTERNAL_ERROR: "The BlueGenji site ran into an error: try again in a moment.",
    CONCURRENT_UPDATE_RETRY: "The BlueGenji site was busy: try again in a moment.",
    UNAUTHORIZED: "The command is misconfigured on this bot (site token refused).",
    SITE_INTERNAL_TOKEN_NOT_CONFIGURED: "The command is not configured on the site (no token).",
    PAYLOAD_TOO_LARGE: "The message is too long: shorten it.",
    INVALID_STAFF_MESSAGE_REQUEST: "The site found the request invalid: run the command again.",
    INVALID_RECIPIENT_CATEGORIES: "Invalid recipient category: run the command again.",
    INVALID_TOURNAMENT_ID: "Invalid tournament number: give its number or the link to its page on the site.",
    INVALID_DISCORD_ID: "Your Discord identifier was not recognised: run the command again.",
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

/** Un envoi sans bilan lisible (connexion coupée, réponse illisible, panne du site) a pu partir. */
const SEND_UNKNOWN_TEXT: Record<Lang, string> = {
  fr: "⚠️ Le site n'a pas confirmé l'envoi : le message est peut-être parti. Ne le relance pas avant d'avoir vérifié le journal du staff.",
  en: "⚠️ The site did not confirm the sending: the message may have gone out. Do not run it again before checking the staff log.",
};

/** Codes d'un envoi dont l'issue est inconnue : le site a pu envoyer avant de lâcher. */
const SEND_UNKNOWN_CODES = new Set([SITE_OUTCOME_UNKNOWN, "INTERNAL_ERROR"]);

/** Refus passagers d'un aperçu : le panneau reste ouvert sur la sélection précédente. */
const TRANSIENT_CODES = new Set([
  SITE_TIMEOUT,
  SITE_UNREACHABLE,
  SITE_BAD_RESPONSE,
  "TOO_MANY_REQUESTS",
  "INTERNAL_ERROR",
  "CONCURRENT_UPDATE_RETRY",
  "STAFF_MESSAGE_UNAVAILABLE",
]);

/**
 * @param code Code d'un aperçu refusé.
 * @returns `true` si le refus est passager (site lent ou muet, trop de demandes) :
 *   réessayer plus tard peut aboutir, le panneau n'a pas à se fermer.
 */
export function isTransientRefusal(code: string): boolean {
  return TRANSIENT_CODES.has(code);
}

/**
 * @param code Code du refus.
 * @param lang Langue de la réponse.
 * @param sending `true` pour un refus rendu à l'envoi (un délai dépassé ou une
 *   réponse perdue y veulent dire « peut-être parti »).
 * @returns Le texte à montrer à l'auteur.
 */
export function refusalText(code: string, lang: Lang, sending = false): string {
  if (sending && code === SITE_TIMEOUT) { return SEND_TIMEOUT_TEXT[lang]; }
  if (sending && SEND_UNKNOWN_CODES.has(code)) { return SEND_UNKNOWN_TEXT[lang]; }
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
  const header = text.header(name, input.preview.tournament.id);
  const footer = ["", text.recipients(counts), hasRecipients(counts) ? text.howTo(input.expiresAt) : text.none].join("\n");
  const content = [header, previewQuote(input.message, DISCORD_MAX - header.length - footer.length - 2, input.lang), footer].join("\n");
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
 * La citation du texte dans l'aperçu, dans la place que laissent l'en-tête et
 * les comptes : coupée en fin de ligne si elle déborde, et dite raccourcie —
 * les comptes et l'échéance restent toujours visibles.
 */
function previewQuote(message: string, room: number, lang: Lang): string {
  const quoted = quoteBlock(message);
  if (quoted.length <= room) { return quoted; }
  const mark = PREVIEW_CUT_MARK[lang];
  const kept: string[] = [];
  let used = mark.length;
  for (const line of quoted.split("\n")) {
    if (used + line.length + 1 > room) { break; }
    kept.push(line);
    used += line.length + 1;
  }
  if (kept.length === 0) { kept.push(cutText(quoted.split("\n")[0], Math.max(1, room - mark.length - 1))); }
  return [...kept, mark].join("\n");
}

/**
 * Le bilan d'un envoi : des nombres, jamais un nom.
 * @param result Bilan du site.
 * @param lang Langue de la réponse.
 * @returns Le texte à montrer à l'auteur.
 */
export function sentText(result: StaffMessageSent, lang: Lang): string {
  const name = escapeDiscord(cutText(result.tournament.name, 120));
  const d = result.delivery;
  // Le site a répondu avant la fin de l'envoi : aucun nombre n'est encore connu.
  if (d.pending) { return TEXT[lang].sendingOn(name); }
  // Rien n'est parti à coup sûr (le site a rendu l'envoi au plafond) : ni coche verte ni « envoyé ».
  if (d.sent + d.pushed + d.unconfirmed === 0) { return d.botUnreachable ? TEXT[lang].nothingDelivered : TEXT[lang].nobodyReached; }
  const lines = [TEXT[lang].sent(name, d)];
  if (d.botUnreachable) { lines.push(TEXT[lang].botUnreachable); }
  if (d.unconfirmed > 0) { lines.push(TEXT[lang].unconfirmed(d.unconfirmed)); }
  return lines.join("\n");
}
