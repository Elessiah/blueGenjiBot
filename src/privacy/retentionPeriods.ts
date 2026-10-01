/**
 * Durées de conservation du bot, sans dépendance : lues par le ménage
 * (`privacy/dataRetention.ts`) comme par les commandes qui annoncent leur
 * fenêtre (`/stats`), sans que celles-ci chargent tout le ménage.
 */

/**
 * Durée de conservation d'un message de service et de ses copies relayées
 * (`messages/manageMsgExpiration.ts`) : effacé au relais suivant l'échéance,
 * au plus tard dans la nuit qui suit.
 */
export const MESSAGE_RETENTION_DAYS = 7;

/**
 * Âge au-delà duquel l'auteur d'un scrim ou d'une recherche est effacé.
 * C'est la fenêtre de `/stats`, seul lecteur de l'auteur. Le ménage passant
 * chaque nuit, l'effacement a lieu dans la nuit qui suit cette échéance
 * (au plus un jour de plus) — les textes le disent ainsi.
 */
export const ACTIVITY_AUTHOR_RETENTION_DAYS = 30;

/**
 * Durée de conservation du fil d'activité (`FeedEvent`) : une ligne par relais,
 * `/scrim` ou `/recrute` (heure exacte, serveur, niveau ou rôle). Alignée sur
 * `ACTIVITY_AUTHOR_RETENTION_DAYS` : au-delà, l'activité ne survit qu'en
 * nombres par jour (`ActivityDaily`), et une ligne datée à la seconde
 * permettrait encore de la rattacher à une personne. Purgée dans la nuit qui
 * suit l'échéance.
 */
export const FEED_EVENT_RETENTION_DAYS = 30;

/**
 * Durée de conservation des messages du journal privé du staff (salon
 * `INFO_SERV` et messages privés envoyés à `OWNER_ID` par `sendLog`) :
 * avis d'exclusion, motifs, erreurs. Un an, comme les journaux d'exclusion
 * du site. Le motif d'une exclusion **en cours** est gardé tant qu'elle dure
 * (il est relu pour prévenir l'exclu), puis effacé à sa levée (`/unban`).
 */
export const STAFF_LOG_RETENTION_DAYS = 365;

/**
 * Durée de conservation d'une copie de secours écrite par `/restore-backup`
 * (`database.sqlite.avant-<date>`). Alignée sur la conservation des
 * sauvegardes chiffrées (`RETENTION_DAYS` de `scripts/backup-onedrive.sh`,
 * `BACKUP_RETENTION_DAYS` côté site) : la copie est la base d'avant, en clair.
 */
export const ROLLBACK_RETENTION_DAYS = 30;
