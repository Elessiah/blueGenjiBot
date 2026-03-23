import {ranks} from './globals.js';

/**
 * Détermine la plage de rangs à appliquer pour le filtrage.
 * @param rank_min Borne basse de rang (incluse). `null` applique la borne par défaut `bronze`.
 * @param rank_max Borne haute de rang (incluse). `null` applique la borne par défaut `oaa`.
 * @returns Tableau des IDs de rang inclus entre les bornes (ordre corrigé automatiquement, bornes par défaut si `null`).
 */
async function defineRankRange(rank_min: string | null,
                               rank_max: string | null): Promise<number[]> {
    let limit_bottom: string;
    let limit_top: string;
    if (rank_min == null) {
        limit_bottom = "bronze";
    } else {
        limit_bottom = rank_min;
    }
    let i: number;
    for (i = 0; i < ranks.length && ranks[i] != limit_bottom; i++);
    let index_bottom: number = i;
    if (rank_max == null) {
        limit_top = "oaa";
    } else {
        limit_top = rank_max;
    }
    for (i = 0; i < ranks.length && ranks[i] != limit_top; i++);
    let index_top: number = i;
    if (index_top < index_bottom) {
        const tmp = index_top;
        index_top = index_bottom;
        index_bottom = tmp;
    }
    const rank_range: number[] = [];
    // + 1 car on ne commence pas à 0
    for (i = index_bottom; i < index_top; i++)
    {
        rank_range.push(i + 1);
    }
    rank_range.push(i + 1);
    return rank_range;
}

export {defineRankRange};
