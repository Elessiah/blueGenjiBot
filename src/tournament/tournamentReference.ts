/**
 * Désignation d'un tournoi du site BlueGenji tapée dans `/message-tournoi` :
 * son numéro, ou un lien vers sa fiche, sous toutes les formes que le site sert.
 *
 * Le site n'a pas de « slug » de tournoi : la fiche vit sous
 * `/tournois/<numéro>` (et `/en/tournois/<numéro>` en anglais, `/suivre/…`
 * pour le suivi sans compte), éventuellement suivie d'un chemin (`/matchs/3`),
 * d'une requête ou d'une ancre. Le bot ne fait qu'**extraire** le numéro : c'est
 * le site qui dit s'il existe et si le message peut partir.
 */

/** Plus grand numéro accepté : au-delà, ce n'est plus un identifiant du site. */
const MAX_TOURNAMENT_ID = Number.MAX_SAFE_INTEGER;

/** Numéro nu, éventuellement précédé de `#`. */
const BARE_ID = /^#?(\d{1,15})$/;

/**
 * Chemin d'une fiche de tournoi : préfixe de langue (`/en`, `/fr`) et de suivi
 * (`/suivre`) facultatifs, puis `/tournois/<numéro>`, puis la fin du chemin ou
 * un sous-chemin.
 */
const TOURNAMENT_PATH = /^\/(?:(?:en|fr)\/)?(?:suivre\/)?tournois\/(\d{1,15})(?:\/|$)/i;

/**
 * @param raw Texte saisi (numéro, `#numéro`, lien absolu, lien sans schéma ou chemin du site).
 * @returns Le numéro du tournoi, ou `null` si le texte n'en désigne aucun.
 */
export function parseTournamentReference(raw: string): number | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > 500) { return null; }
  const bare = BARE_ID.exec(text);
  if (bare) { return toId(bare[1]); }
  const path = pathOf(text);
  if (path === null) { return null; }
  const match = TOURNAMENT_PATH.exec(path);
  return match ? toId(match[1]) : null;
}

/** Le chemin d'un lien (absolu, sans schéma, ou déjà un chemin), sans requête ni ancre. */
function pathOf(text: string): string | null {
  if (text.startsWith("/")) { return text.split(/[?#]/)[0]; }
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") { return null; }
    return url.pathname;
  } catch {
    return null;
  }
}

function toId(digits: string): number | null {
  const id = Number(digits);
  return Number.isSafeInteger(id) && id > 0 && id <= MAX_TOURNAMENT_ID ? id : null;
}
