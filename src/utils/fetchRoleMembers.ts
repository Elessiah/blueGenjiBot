/**
 * Lit les membres d'un rôle sans se fier au seul cache du bot.
 *
 * `role.members` ne filtre que les membres déjà en cache : après un
 * redémarrage, un rôle peuplé paraît vide tant que la guilde n'a pas été
 * récupérée. Partagé par l'alerte aux arbitres et l'envoi des adhésions.
 */

import type {Guild, GuildMember, Role} from "discord.js";

/**
 * Membres d'un rôle, après récupération de tous les membres du serveur si le
 * cache est incomplet.
 *
 * La récupération complète est limitée en débit par Discord (par serveur) :
 * elle n'est demandée que si le cache compte moins de membres que le serveur,
 * si bien que plusieurs lectures d'un même serveur dans un passage n'en
 * coûtent qu'une. Le délai reste celui de discord.js.
 *
 * @param guild Serveur du rôle.
 * @param role Rôle à lire.
 * @returns Les membres du rôle, dans l'ordre du cache.
 * @throws L'erreur de la récupération (délai dépassé, limite de débit,
 *   passerelle) : à l'appelant de décider quoi en faire.
 */
async function fetchRoleMembers(guild: Guild, role: Role): Promise<GuildMember[]> {
    // Négation plutôt que `<` : un compte inconnu (`memberCount` absent) force
    // la récupération au lieu de se fier au cache.
    if (!(guild.members.cache.size >= guild.memberCount)) {
        await guild.members.fetch();
    }
    return [...role.members.values()];
}

export {fetchRoleMembers};
