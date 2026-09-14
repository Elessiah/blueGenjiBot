/**
 * Lit le role admin du bot configure pour un serveur.
 *
 * Separe de `checkAdminRole` (qui, lui, verifie un membre precis) car
 * plusieurs endroits ont besoin du role lui-meme sans membre a tester :
 * `/show-bot-admin` l'affiche tel quel, `checkAdminRole` s'en sert comme
 * brique.
 */

import {Guild} from "discord.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";

/**
 * @param guild Serveur dont on cherche le role admin du bot.
 * @returns L'ID du role, ou `null` si aucun n'est configure pour ce serveur.
 */
async function getAdminRole(guild: Guild): Promise<string | null> {
    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get("RoleAdmin", ["role_id"], undefined, {query: "guild_id = ?", values:[guild.id]});
    if (result.length > 0)
        return (result[0] as {role_id: string}).role_id;
    return null;
}

export {getAdminRole};