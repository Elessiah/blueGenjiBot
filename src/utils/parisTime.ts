/**
 * Résolution d'une heure de l'horloge **parisienne** en instant absolu.
 *
 * Les rappels d'adhésion sont annoncés « à 10:00 (heure Europe/Paris) » —
 * `doc/adhesions-commands-user.md` l'écrit deux fois — et la tâche cron qui les
 * déclenche épingle bien ce fuseau. Mais la date du prochain envoi, elle, se
 * calculait avec `Date.prototype.setHours`, qui ne connaît qu'un seul fuseau :
 * **celui de la machine**. Trois conventions se croisaient donc — cron en
 * Europe/Paris, calcul en heure serveur, stockage et comparaison en UTC — et
 * elles ne s'accordaient que tant que l'horloge du serveur était à Paris.
 *
 * Ce n'est pas une hypothèse d'école : l'image Docker par défaut tourne en UTC.
 * Là, `setHours(10)` écrit 10:00 UTC quand le cron se réveille à 08:00 UTC ;
 * la ligne n'est donc pas due, elle attend le réveil du lendemain, et comme
 * chaque envoi réamorce le compte depuis cet instant, **le rappel gagne un jour
 * à chaque période**, sans une erreur ni une ligne de journal.
 *
 * Le fuseau est ici nommé une fois et résolu par `Intl`, qui porte la base des
 * changements d'heure. Plus rien ne dépend de `TZ`.
 */

/** Le seul fuseau dans lequel ce bot annonce une heure. */
const PARIS_TIME_ZONE = "Europe/Paris";

const PARIS_PARTS = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
});

/** Les champs de l'horloge murale parisienne à un instant donné. */
type WallClock = {
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    second: number,
};

/**
 * Lit l'horloge parisienne d'un instant.
 * @param instant Instant à lire.
 * @returns Les champs affichés par une horloge posée à Paris.
 */
function parisWallClock(instant: Date): WallClock {
    const parts = PARIS_PARTS.formatToParts(instant);
    const read = (type: Intl.DateTimeFormatPartTypes): number => {
        const found = parts.find((part) => part.type === type);
        return found ? Number(found.value) : 0;
    };
    return {
        year: read("year"),
        month: read("month"),
        day: read("day"),
        hour: read("hour"),
        minute: read("minute"),
        second: read("second"),
    };
}

/**
 * Décalage d'Europe/Paris par rapport à UTC, à un instant donné.
 * @param instant Instant auquel mesurer le décalage.
 * @returns Le décalage en millisecondes (+1 h en hiver, +2 h en été).
 */
function parisOffsetMs(instant: Date): number {
    const wall = parisWallClock(instant);
    const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    // `formatToParts` tronque à la seconde : on compare donc à l'instant
    // lui-même tronqué, sinon le décalage porterait les millisecondes en trop.
    return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Instant auquel l'horloge parisienne affichera `hour:00:00`, `days` jours
 * après le **jour parisien** de `from`.
 *
 * Le jour se compte sur le calendrier de Paris et non sur celui du serveur :
 * à 23:30 UTC on est déjà au lendemain à Paris, et « dans 7 jours » doit partir
 * de ce lendemain-là.
 *
 * Deux passes suffisent : la première corrige avec le décalage d'un instant
 * approché, la seconde avec celui de l'instant trouvé. Elles convergent parce
 * que l'erreur de la première est au plus d'une heure, et qu'une heure autour
 * de 10:00 ne franchit aucun changement d'heure — à Paris ils tombent à 02:00
 * et à 03:00. Une heure choisie dans ce creux-là n'aurait pas cette garantie :
 * 02:30 n'existe pas le dimanche de mars et existe deux fois celui d'octobre.
 *
 * @param from Instant de référence.
 * @param days Nombre de jours à ajouter au jour parisien de `from`.
 * @param hour Heure parisienne visée, sur 24 h.
 * @returns L'instant correspondant.
 */
function parisDaysLater(from: Date, days: number, hour: number): Date {
    const wall = parisWallClock(from);
    // `Date.UTC` normalise le débordement : le 35 octobre devient le 4 novembre.
    const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day + days, hour);
    const approx = asIfUtc - parisOffsetMs(new Date(asIfUtc));
    return new Date(asIfUtc - parisOffsetMs(new Date(approx)));
}

export {PARIS_TIME_ZONE, parisDaysLater, parisOffsetMs, parisWallClock};
