import { cutText } from "../utils/cutText.js";

/** Longueur maximale de l'étiquette `context` du site (journaux pm2 et salon de logs). */
export const MAX_SITE_CONTEXT_LENGTH = 200;

/**
 * Caractères d'une étiquette `context` du site (`match-12`, `live-announce tournoi-7
 * match-12,13,…+4`). Ni `_`, ni `*`, ni `:`, ni `<`, ni `` ` `` : aucune mise en forme
 * Discord (`__souligné__`, `_italique_`, `:emoji:`), aucune mention, aucun saut de ligne.
 */
const CONTEXT_UNSAFE = /[^A-Za-z0-9 ,+…-]/gu;

/**
 * Étiquette `context` du site, réduite à des caractères sûrs (les autres deviennent
 * `-`, neutre) et bornée d'un « … » visible : elle part telle quelle au salon de logs
 * et au journal du processus. Seule définition, pour toutes les routes du site
 * (notifications, alertes d'arbitre, annonces de live).
 * @param value Valeur reçue.
 * @param fallback Étiquette à défaut (absente, vide ou pas une chaîne).
 * @returns L'étiquette sûre.
 */
export function sanitizeSiteContext(value: unknown, fallback: string): string {
  if (typeof value !== "string") { return fallback; }
  const clean = value.trim().replace(CONTEXT_UNSAFE, "-");
  return clean.length > 0 ? cutText(clean, MAX_SITE_CONTEXT_LENGTH) : fallback;
}
