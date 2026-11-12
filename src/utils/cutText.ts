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
