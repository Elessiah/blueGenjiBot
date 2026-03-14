import {Guild} from "discord.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";

async function getAdminRole(guild: Guild): Promise<string | null> {
    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get("RoleAdmin", ["role_id"], undefined, {query: "guild_id = ?", values:[guild.id]});
    if (result.length > 0)
        return (result[0] as {role_id: string}).role_id;
    return null;
}

export {getAdminRole};