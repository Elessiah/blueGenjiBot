export type BanInfo = {
    id_user: string;
    id_moderator: string;
    id_reason: string;
    date: Date;
};

/**
 * Issue d'une vérification de bannissement.
 *
 * Trois états et non deux : « on n'a pas pu savoir » n'est pas « il n'est pas
 * banni ». La base est un fichier SQLite local, verrouillé pendant la
 * sauvegarde nocturne — la fenêtre où la lecture échoue est régulière, pas
 * théorique. Rendre `false` pendant cette fenêtre lève tous les bannissements
 * chaque nuit ; rendre `true` accuse tout le monde. C'est à l'appelant de
 * trancher, parce que lui seul sait quoi répondre.
 */
export type BanVerdict = "BANNED" | "NOT_BANNED" | "UNKNOWN";
