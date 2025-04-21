const areaFilter = Object.freeze({
    ALL: 0,
    EU: 1,
    NA: 2,
    LATAM: 3,
    ASIA: 4,
});

const services = ['lfs', 'ta', 'lfsub', 'lft', 'lfp', 'lfg', 'lfstaff', 'lfcast'];
const ranks = ['bronze', 'silver', 'gold', 'plat', 'diam', 'gm', 'cel', 'et', 'oaa'];
const regions = ["ALL", "EU", "NA", "LATAM", "ASIA"];

const ranksMatch = {
    'bronze': 'bronze',
    'silver': 'silver',
    'gold': 'gold',
    'platinum': 'plat',
    'plat': 'plat',
    'platine': 'plat',
    'platinium': 'plat',
    'diamond': 'diam',
    'diamant': 'diam',
    'diams': 'diam',
    'master': 'ma',
    'grandmaster': 'gm',
    'grand master': 'gm',
    'gm': 'gm',
    'celestial': 'cel',
    'cel': 'cel',
    'celeste': 'cel',
    'eternity': 'et',
    'eternels': 'et',
    'et': 'et',
};

module.exports = {areaFilter, regions, services, ranks, ranksMatch};