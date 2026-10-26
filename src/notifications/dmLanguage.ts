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
 *   `locale`), et ses fonctions à lui (adhésions, bannissement, contact des
 *   administrateurs de serveur) — il ne connaît pas le compte du site de ces
 *   personnes, le message est donc bilingue.
 *
 * Module pur : aucun accès à Discord ni à la base.
 */

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

/** Avis par défaut d'une adhésion périmée (`/adhesion-perimee`). */
export const ADHESION_EXPIRED_DM = bilingualText({
  fr: "Votre adhésion à l'association est à présent périmée. Pour la renouveler, veuillez contacter le bureau ou utiliser la commande dédiée.",
  en: "Your membership of the association has now expired. To renew it, please contact the board or use the dedicated command.",
});

/**
 * Avis d'exclusion du relais remis à l'exclu, suivi du motif tel que le
 * modérateur l'a écrit (une seule fois, après les deux langues).
 * @param date Date de l'exclusion, telle qu'enregistrée (écrite comme avant, `String(date)`).
 * @param reason Motif, texte du modérateur.
 * @returns Le message à envoyer.
 */
export function banNoticeMessage(date: Date | string, reason: string): string {
  return bilingualText({
    fr: "Vous êtes exclu du relais depuis le " + String(date) + " :",
    en: "You have been banned from the relay since " + String(date) + ":",
  }) + " \n" + reason;
}

/**
 * Message du code de connexion envoyé en privé (`/internal/auth/send-code`).
 * Le français est celui envoyé depuis toujours, inchangé.
 * @param code Code à six chiffres.
 * @param locale Langue du compte, ou `null` si elle est inconnue.
 * @returns Le message à envoyer.
 */
export function loginCodeMessage(code: string, locale: DmLocale | null): string {
  return localizedText(locale, {
    fr: `BlueGenji Arena - Code de connexion: **${code}** (valide 10 minutes).`,
    en: `BlueGenji Arena - Login code: **${code}** (valid for 10 minutes).`,
  });
}
