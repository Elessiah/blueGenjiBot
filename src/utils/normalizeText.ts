/**
 * Nettoie un texte pour les comparaisons (casse, accents, espaces).
 * @param text Texte brut à normaliser pour comparaison.
 * @returns Texte normalisé sans accents et en minuscules, prêt pour les comparaisons.
 */
function normalizeText(text: string): string {
  return text
    .normalize("NFD")               // décompose les lettres accentuées
    .replace(/[\u0300-\u036f]/g, "") // supprime les diacritiques (accents)
    .toLowerCase();                  // met tout en minuscule
}

export {normalizeText};
