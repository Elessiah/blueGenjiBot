const {ranks} = require('./globals');

async function defineRankRange(rank_min, rank_max) {
    let limit_bottom;
    let limit_top;
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
    let i = 0;
    while (ranks[i] !== limit_bottom) {
        i += 1;
    }
    let rank_range = [];
    while (ranks[i] !== limit_top) {
        rank_range.push(i + 1);
        i += 1;
    }
    rank_range.push(i + 1);
    return rank_range;
}

module.exports = defineRankRange;