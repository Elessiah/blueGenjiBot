/**
 * Recherche une sous-chaîne avec normalisation selon les options.
 * @param word Mot-clé recherché (testé avec bornes de mot regex).
 * @param string Texte dans lequel effectuer la recherche.
 * @returns `true` si `word` est trouvé au moins une fois comme mot complet dans `string`, sinon `false`.
 */

async function searchString(word: string,
                            string: string): Promise<boolean> {
// Utilisation d'une expression régulière avec les délimiteurs de mot
    const regex = new RegExp(String.raw`\b${word}\b`);
    return regex.test(string);
}

export {searchString};
