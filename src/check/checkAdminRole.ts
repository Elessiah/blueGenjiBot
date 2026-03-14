import {Guild, GuildMember} from "discord.js";
import {getAdminRole} from "@/utils/getAdminRole.js";

async function checkAdminRole(member: GuildMember): Promise<boolean> {
    const guild: Guild = member.guild;
    const role_id: string | null = await getAdminRole(guild);
    if (!role_id) {
        return false;
    }
    return !!member.roles.cache.get(role_id);
}

export {checkAdminRole};