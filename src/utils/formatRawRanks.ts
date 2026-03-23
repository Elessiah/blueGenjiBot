import {rankChoices} from "../config/rankChoices.js";

/**
 * Normalise la liste brute des rangs saisie par l'utilisateur.
 * @param rawRanks Codes de rangs bruts à convertir en libellés lisibles.
 * @returns Liste Markdown des rangs reconnus (une ligne par rang), ou chaîne vide si aucun rang ne correspond.
 */
async function formatRawRanks(rawRanks: string[]): Promise<string> {
    let prettyRanks = "";
    for (const rank of rawRanks) {
        for (const choice of rankChoices) {
            if (choice.value === rank) {
                prettyRanks += `- **${choice.name}**\n`;
            }
        }
    }
    return prettyRanks;
}

export {formatRawRanks};
