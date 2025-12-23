import {ranks} from './globals.js';

async function defineRankRange(rank_min: string,
                               rank_max: string): Promise<number[]> {
    let limit_bottom: string;
    let limit_top: string;
    if (rank_min == null) {
        limit_bottom = "bronze";
    } else {
        limit_bottom = rank_min;
    }
    if (rank_max == null) {
        limit_top = "oaa";
    } else {
        limit_top = rank_max;
    }
    let i: number = 0;
    while (ranks[i] !== limit_bottom) {
        i += 1;
    }
    const rank_range: number[] = [];
    while (ranks[i] !== limit_top) {
        rank_range.push(i + 1);
        i += 1;
    }
    rank_range.push(i + 1);
    return rank_range;
}

export {defineRankRange};