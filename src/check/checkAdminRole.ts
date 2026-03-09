import {Guild, GuildMember} from "discord.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";

async function checkAdminRole(member: GuildMember): Promise<boolean> {
    const guild: Guild = member.guild;
    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get("RoleAdmin", ["role_id"], undefined, {query: "guild_id = ?", values:[guild.id]});
    if (result.length == 0) {
        return false;
    }
    const role_id: string = result[0] as string;
    return !!member.roles.cache.get(role_id);
}

export {checkAdminRole};