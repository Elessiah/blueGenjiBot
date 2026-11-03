export type BanInfo = {
    id_user: string;
    id_moderator: string;
    id_reason: string;
    date: Date;
    /** Dernier avis remis en message privé à l'exclu ; `null` sans avis. */
    id_notice_user?: string | null;
    /** Instant (ms) du dernier essai d'avis ; `null` sans essai. */
    notice_user_at?: number | null;
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
