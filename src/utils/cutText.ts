/**
 * Coupe un texte sans séparer une paire de substitution UTF-16 (un émoji) :
 * une moitié d'émoji s'afficherait en caractère cassé.
 * @param text Texte à couper.
 * @param length Longueur maximale (en unités UTF-16).
 * @returns Au plus `length` unités, sans moitié de paire à la fin.
 */
export function sliceWithoutSplittingPair(text: string, length: number): string {
  let cut = Math.max(0, Math.min(length, text.length));
  if (cut > 0 && cut < text.length && /[\uD800-\uDBFF]/.test(text.charAt(cut - 1))) { cut -= 1; }
  return text.slice(0, cut);
}

/**
 * Coupe un texte à `max` unités au plus, terminé par « … », sans jamais
 * couper un caractère en deux (émoji, lettre hors du plan de base) : un « � »
 * sous `@everyone` aurait l'air d'une panne. Repose sur
 * {@link sliceWithoutSplittingPair} : une seule règle de coupe pour tout le bot.
 * @param text Texte à couper.
 * @param max Longueur maximale, « … » compris (en unités UTF-16).
 * @returns Le texte, coupé au besoin.
 */
export function cutText(text: string, max: number): string {
  if (text.length <= max) { return text; }
  return `${sliceWithoutSplittingPair(text, max - 1)}…`;
}
