/**
 * Verifie si un membre porte le role admin du bot configure pour son serveur.
 *
 * Distinct de la permission Discord `Administrator` : le role admin du bot
 * est un role dedie, choisi par `/set-bot-admin`, qui permet de deleguer la
 * gestion du bot a des membres sans leur donner le controle du serveur.
 */

import {Guild, GuildMember} from "discord.js";
import {getAdminRole} from "@/utils/getAdminRole.js";

/**
 * @param member Membre a verifier.
 * @returns `true` si le serveur a un role admin configure et que le membre le possede.
 */
async function checkAdminRole(member: GuildMember): Promise<boolean> {
    const guild: Guild = member.guild;
    const role_id: string | null = await getAdminRole(guild);
    if (!role_id) {
        return false;
    }
    return !!member.roles.cache.get(role_id);
}

export {checkAdminRole};