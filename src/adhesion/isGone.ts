import { DiscordAPIError } from "discord.js";
import { RESTJSONErrorCodes } from "discord-api-types/v10";

/**
 * Codes par lesquels Discord dit « cet objet n'existe pas », et rien d'autre.
 *
 * Volontairement courts et nommés un par un : c'est la seule liste qui autorise
 * une **suppression définitive** en base, et une liste large finirait par y
 * laisser entrer une panne.
 */
const GONE_CODES: ReadonlySet<number> = new Set<number>([
  RESTJSONErrorCodes.UnknownUser,
  RESTJSONErrorCodes.UnknownGuild,
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownRole,
]);

/**
 * L'erreur dit-elle que la cible **n'existe plus**, ou seulement qu'on n'a pas
 * pu la joindre ?
 *
 * La distinction n'est pas théorique : `fetchTargets` supprimait l'intervalle
 * dans son `catch`, sans regarder la cause. Une limite de débit, une coupure
 * réseau, une passerelle pas encore prête au démarrage — tout cela lève, et
 * toutes ces levées effaçaient une programmation que personne ne pouvait plus
 * retrouver. Une erreur passagère doit faire **attendre le prochain passage**,
 * jamais supprimer.
 *
 * Par défaut on répond `false` : dans le doute, on garde la ligne. Une
 * programmation qui survit à tort se supprime d'une commande ; une programmation
 * effacée à tort ne se retrouve pas.
 *
 * @param error Erreur levée par un appel `fetch` de discord.js.
 * @returns `true` seulement si Discord a explicitement dit que l'objet est inconnu.
 */
export function isGone(error: unknown): boolean {
  return error instanceof DiscordAPIError && GONE_CODES.has(Number(error.code));
}
