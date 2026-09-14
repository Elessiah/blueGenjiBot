/**
 * Choix de services partenaires proposes dans les options de commandes Discord (`/assign-channel`, `/list-partner`...).
 *
 * Les valeurs (`lfs`, `ta`, ...) sont les codes stockes en base dans
 * `Service` : ne pas les modifier sans migrer les lignes existantes, sous
 * peine de rompre les assignations de salons deja en place.
 */
const servicesChoices: {name: string, value: string}[] = [
    {
        name: "LookForScrim",
        value: "lfs"
    },
    {
        name: "TournamentAnnouncement",
        value: "ta"
    },
    {
        name: "LookForSub",
        value: "lfsub"
    },
    {
        name: "LookForTeam",
        value: "lft"
    },
    {
        name: "LookForPlayer",
        value: "lfp"
    },
    {
        name: "LookForGroup",
        value: "lfg"
    },
    {
        name: "LookForStaff",
        value: "lfstaff"
    },
    {
        name: "LookForCast",
        value: "lfcast"
    }
];

export {servicesChoices};