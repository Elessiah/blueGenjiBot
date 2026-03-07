import {regions} from "../utils/globals.js";
import {searchString} from "../utils/searchString.js";

/**
 * Calcule les régions cibles de diffusion à partir de la région source et des règles de relais.
 * @param currentRegion Région du salon source (0 = ALL).
 * @param messageContentLower Contenu du message en minuscules, utilisé pour détecter les mots-clés.
 * @returns Objet de ciblage avec `query` (SQL) et `requestedRegions` (indices de régions), ou `null` si aucune région n'est détectée et que la source vaut `0` (ALL).
 */
async function getTargetRegions(currentRegion: number,
                                messageContentLower: string): Promise<{query: string, requestedRegions: number[]} | null> {
    let requestedRegions: number[] = [];
    let query: string = "";
    for (let i: number = 1; i < regions.length; i++) { // 1 pour éviter de check ALL
        if (await searchString(regions[i].toLowerCase(), messageContentLower)) {
            requestedRegions.push(i);
            if (query.length > 0)
                query += " OR ";
            query += "ChannelPartner.region = " + i;
        }
    }
    if (requestedRegions.length === 0 && currentRegion !== 0) {
        requestedRegions.push(currentRegion);
        query += "ChannelPartner.region = " + currentRegion;
    } else if (currentRegion === 0)
        return null;
    return {query: query, requestedRegions: requestedRegions};
}

export {getTargetRegions};
