const areaFilter = Object.freeze({
    ALL: 0,
    EU: 1,
    NA: 2,
    LATAM: 3,
    ASIA: 4,
});

const YesNo = Object.freeze({
    YES: 0,
    NO: 1,
});

const services: Array<string> = ['lfs', 'ta', 'lfsub', 'lft', 'lfp', 'lfg', 'lfstaff', 'lfcast'];
const ranks: Array<string> = ['bronze', 'silver', 'gold', 'plat', 'diam', 'gm', 'cel', 'et', 'oaa'];
const regions: Array<string> = ["ALL", "EU", "NA", "LATAM", "ASIA"];

const ranksMatch: { [key: string]: string } = {
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
    'diam': 'diam',
    'd': 'diam',
    'grandmaster': 'gm',
    'grand master': 'gm',
    'grandmaitre': 'gm',
    'grand maitre': 'gm',
    'gm': 'gm',
    'celestial': 'cel',
    'cel': 'cel',
    'cels': 'cel',
    'c': 'cel',
    'celeste': 'cel',
    'celest': 'cel',
    'celestia': 'cel',
    'eternal': 'et',
    'eternity': 'et',
    'eternels': 'et',
    'et': 'et',
    'oaa': 'oaa',
    'OneAboveAll': 'oaa',
    'one above all': 'oaa',
    'ooa': 'oaa'
};

export {areaFilter, YesNo, regions, services, ranks, ranksMatch};