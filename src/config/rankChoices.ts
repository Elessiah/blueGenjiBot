/**
 * Choix de rangs proposes dans les options de commandes Discord (filtres de salon, adhesion...).
 *
 * Liste figee en dur plutot que derivee de `utils/globals.ts` (`ranks`,
 * `ranksMatch`) : Discord exige des paires `name`/`value` litterales pour ses
 * choix de commande, un format different de celui utilise pour matcher un
 * rang tape librement dans un message.
 */
const rankChoices = [
    {
        name: "Bronze",
        value: "bronze"
    },
    {
        name: "Silver (Argent)",
        value: "silver"
    },
    {
        name: "Gold (Or)",
        value: "gold"
    },
    {
        name: "Platinum (Platine)",
        value: "plat"
    },
    {
        name: "Diamond (Diamant)",
        value: "diam"
    },
    {
        name: "GrandMaster (Grand Maître)",
        value: "gm"
    },
    {
        name: "Celestial (Céleste)",
        value: "cel"
    },
    {
        name: "Eternity (Éternité)",
        value: "et"
    },
    {
        name: "One Above All (Au-Dessus de Tous)",
        value: "oaa"
    }
];

export {rankChoices};
