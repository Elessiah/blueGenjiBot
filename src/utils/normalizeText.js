function normalizeText(text) {
  return text
    .normalize("NFD")               // décompose les lettres accentuées
    .replace(/[\u0300-\u036f]/g, "") // supprime les diacritiques (accents)
    .toLowerCase();                  // met tout en minuscule
}

module.exports = normalizeText;