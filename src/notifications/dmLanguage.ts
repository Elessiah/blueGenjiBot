/**
 * Langue des messages privés que le bot écrit à une personne.
 *
 * Règle de l'association (2026-10-13) : un message privé part dans la langue
 * du compte du site (`bg_users.locale`) quand elle est connue, sinon **un seul**
 * message qui porte le français puis l'anglais. Les messages de salon (#live,
 * journal, salons du staff) restent en français.
 *
 * Qui décide :
 *
 * - le **site** pour ce qu'il rédige (rappels de match, avis de compte…) : il
 *   rend le texte dans la bonne langue avant de l'envoyer, le bot ne fait que le
 *   distribuer (`/internal/notify/dm`) ou l'écrire tel quel en message privé
 *   (`dmMessage` de `/internal/notify/referees` et `/leadership`) ;
 * - le **bot** pour ses propres textes : le code de connexion (le site envoie
 *   `locale`), et ses fonctions à lui (adhésions, bannissement) — il ne
 *   connaît pas le compte du site de ces personnes, le message est donc
 *   bilingue. Le contact des administrateurs de serveur relaie, lui, le texte
 *   de son auteur tel quel.
 *
 * Module pur : aucun accès à Discord ni à la base.
 */

import { sliceWithoutSplittingPair } from "../utils/cutText.js";

/** Langue d'un compte du site. */
export type DmLocale = "fr" | "en";

/**
 * Séparateur entre le français et l'anglais d'un message bilingue. Le site
 * écrit le même (`lib/shared/dm-language.ts` d'AppBlueGenji) : un joueur
 * reconnaît la coupure d'où qu'elle vienne.
 */
export const BILINGUAL_SEPARATOR = "\n\n**— English —**\n";

/** Un texte écrit dans les deux langues. */
export interface BilingualText {
  fr: string;
  en: string;
}

/**
 * Lit la langue transmise par le site.
 *
 * Toute autre valeur qu'une langue connue (champ absent d'un site plus ancien,
 * `null`, faute de frappe) vaut « inconnue » : le message part alors bilingue,
 * ce qui ne laisse jamais quelqu'un devant une langue qu'il ne lit pas.
 *
 * @param value Valeur reçue (`locale` du corps JSON).
 * @returns La langue, ou `null` si elle est inconnue.
 */
export function parseDmLocale(value: unknown): DmLocale | null {
  return value === "fr" || value === "en" ? value : null;
}

/**
 * Message bilingue : le français, le séparateur, puis l'anglais.
 * @param text Les deux versions.
 * @returns Le message unique à envoyer.
 */
export function bilingualText(text: BilingualText): string {
  return text.fr + BILINGUAL_SEPARATOR + text.en;
}

/**
 * Le texte à écrire à une personne selon sa langue.
 * @param locale Langue du compte, ou `null` si elle est inconnue.
 * @param text Les deux versions.
 * @returns La version de la langue, ou le message bilingue.
 */
export function localizedText(locale: DmLocale | null, text: BilingualText): string {
  if (locale === null) { return bilingualText(text); }
  return text[locale];
}

/**
 * Papiers d'adhésion remis **en message privé** quand l'auteur n'a pas écrit de
 * message : bilingue, le bot ne connaît pas le compte du site du membre. Le
 * salon, lui, reçoit le français seul (`DEFAULT_ADHESION_MESSAGE`).
 */
export const ADHESION_PAPERS_DM = bilingualText({
  fr: "Voici les papiers pour l'adhésion à l'association BlueGenji :",
  en: "Here are the membership papers for the BlueGenji association:",
});

/** Confirmation par défaut d'une adhésion validée (`/adhesion-valide`). */
export const ADHESION_VALID_DM = bilingualText({
  fr: "Votre adhésion BlueGenji a été validée. Merci d'avoir rejoint l'association !",
  en: "Your BlueGenji membership has been confirmed. Thank you for joining the association!",
});

/** Avis par défaut d'une adhésion périmée, programmé par `/adhesion-valide`. */
export const ADHESION_EXPIRED_REMINDER_DM = bilingualText({
  fr: "Votre adhésion BlueGenji est périmée. Merci de renouveler votre adhésion si vous souhaitez continuer à être membre de l'association !",
  en: "Your BlueGenji membership has expired. Please renew it if you wish to remain a member of the association!",
});

/**
 * Ancien avis par défaut d'une adhésion périmée, français seul, enregistré par
 * `/adhesion-valide` avant les messages bilingues. Les rappels programmés avec
 * ce texte sont remis au texte bilingue au démarrage (`Bdd`) : un texte
 * personnalisé, lui, n'est jamais touché.
 */
export const LEGACY_ADHESION_EXPIRED_REMINDER_FR =
  "Votre adhésion BlueGenji a périmée. Merci de renouveler votre adhésion si vous souhaitez continuer à être membre de l'association!";

/** Avis par défaut d'une adhésion périmée (`/adhesion-perimee`). */
export const ADHESION_EXPIRED_DM = bilingualText({
  fr: "Votre adhésion à l'association est à présent périmée. Pour la renouveler, veuillez contacter le bureau ou utiliser la commande dédiée.",
  en: "Your membership of the association has now expired. To renew it, please contact the board or use the dedicated command.",
});

/** Fuseau des dates écrites aux joueurs : l'association est française. */
const DM_TIME_ZONE = "Europe/Paris";

/** Une date SQLite `CURRENT_TIMESTAMP` (« AAAA-MM-JJ HH:MM:SS », en UTC). */
const SQLITE_UTC_DATETIME = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/;

/**
 * Formateurs de date, construits au premier besoin puis gardés : la construction
 * d'un `Intl.DateTimeFormat` est coûteuse, et la plupart des modules qui importent
 * celui-ci n'écrivent jamais d'avis d'exclusion.
 */
const banDateFormatters: Partial<Record<DmLocale, Intl.DateTimeFormat>> = {};

/** Formateur de date d'exclusion de la langue voulue. */
function banDateFormatter(locale: DmLocale): Intl.DateTimeFormat {
  let formatter = banDateFormatters[locale];
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: DM_TIME_ZONE,
    });
    banDateFormatters[locale] = formatter;
  }
  return formatter;
}

/**
 * Date d'une exclusion, écrite à l'heure de Paris dans la langue voulue.
 *
 * La colonne `Ban.date` vaut `CURRENT_TIMESTAMP` : une chaîne en UTC, sans
 * fuseau, que `new Date` lirait à l'heure locale du serveur. Elle est donc lue
 * comme UTC. Une valeur illisible est rendue telle quelle plutôt que perdue.
 * @param date Date enregistrée (`Date` ou chaîne SQLite).
 * @param locale Langue du texte.
 * @returns La date, par exemple « 26 octobre 2026 à 14:03 » / “26 October 2026 at 14:03”.
 */
export function formatBanDate(date: Date | string, locale: DmLocale): string {
  let parsed: Date;
  if (date instanceof Date) {
    parsed = date;
  } else {
    const sqlite = SQLITE_UTC_DATETIME.exec(String(date));
    parsed = new Date(sqlite ? `${sqlite[1]}T${sqlite[2]}Z` : String(date));
  }
  if (Number.isNaN(parsed.getTime())) { return String(date); }
  return banDateFormatter(locale).format(parsed);
}

/**
 * Avis d'exclusion du relais remis à l'exclu, suivi du motif tel que le
 * modérateur l'a écrit (une seule fois, après les deux langues).
 * @param date Date de l'exclusion, telle qu'enregistrée (écrite à l'heure de Paris, voir {@link formatBanDate}).
 * @param reason Motif, texte du modérateur.
 * @returns Le message à envoyer.
 */
export function banNoticeMessage(date: Date | string, reason: string): string {
  const head = bilingualText({
    fr: "Vous êtes exclu du relais depuis le " + formatBanDate(date, "fr") + " :",
    en: "You have been banned from the relay since " + formatBanDate(date, "en") + ":",
  }) + " \n";
  // Discord refuse un message privé de plus de 2000 caractères, et le refus
  // reviendrait à chaque avis : le motif est coupé pour que l'avis tienne,
  // en-tête bilingue compris.
  const room = DISCORD_DM_MAX_LENGTH - head.length;
  if (reason.length <= room) { return head + reason; }
  return head + sliceWithoutSplittingPair(reason, Math.max(0, room - 1)) + "…";
}

/** Plafond d'un message Discord (l'API refuse au-delà). */
const DISCORD_DM_MAX_LENGTH = 2000;

/** Nom de marque écrit dans les messages privés du bot. */
export const BRAND_NAME = "BlueGenji";

/**
 * Objet d'un code envoyé en privé (`purpose` de `/internal/auth/send-code`).
 *
 * - `login` : connexion au site par Discord (défaut, et toute valeur inconnue :
 *   un site plus ancien n'envoie pas ce champ) ;
 * - `handle` : certification ou changement du tag Discord d'un compte du site.
 *   Le demandeur n'est pas forcément le titulaire du tag : le texte le dit, pour
 *   qu'il ne croie pas à une connexion à son propre compte et ne transmette pas
 *   le code.
 */
export type CodePurpose = "login" | "handle";

/**
 * Lit l'objet du code transmis par le site.
 * @param value Valeur reçue (`purpose` du corps JSON).
 * @returns `handle` pour un code de tag, `login` sinon.
 */
export function parseCodePurpose(value: unknown): CodePurpose {
  return value === "handle" ? "handle" : "login";
}

/**
 * Message du code envoyé en privé (`/internal/auth/send-code`).
 * Le français du code de connexion est celui envoyé depuis toujours, inchangé.
 * @param code Code à six chiffres.
 * @param locale Langue du compte, ou `null` si elle est inconnue.
 * @param purpose Objet du code (connexion par défaut).
 * @returns Le message à envoyer.
 */
export function loginCodeMessage(code: string, locale: DmLocale | null, purpose: CodePurpose = "login"): string {
  if (purpose === "handle") {
    return localizedText(locale, {
      fr: `${BRAND_NAME} - Code de vérification de votre tag Discord : **${code}** (valide 10 minutes). Il sert à rattacher ce tag à un compte ${BRAND_NAME}, pas à vous connecter. Si vous n'en êtes pas à l'origine, ignorez ce message et ne transmettez ce code à personne.`,
      en: `${BRAND_NAME} - Verification code for your Discord tag: **${code}** (valid for 10 minutes). It links this tag to a ${BRAND_NAME} account; it does not sign you in. If you did not request it, ignore this message and never share this code.`,
    });
  }
  return localizedText(locale, {
    fr: `${BRAND_NAME} - Code de connexion: **${code}** (valide 10 minutes).`,
    en: `${BRAND_NAME} - Login code: **${code}** (valid for 10 minutes).`,
  });
}
