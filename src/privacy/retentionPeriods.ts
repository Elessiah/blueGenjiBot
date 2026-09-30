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
