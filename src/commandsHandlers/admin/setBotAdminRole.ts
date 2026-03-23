import {ChatInputCommandInteraction, Client, Role} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {status} from "@/types.js";
import {sendLog} from "@/safe/sendLog.js";

async function setBotAdminRole(client: Client,
                               interaction: ChatInputCommandInteraction): Promise<void>  {
    if (!interaction.guild) {
        await safeReply(interaction, "You must be on a partner server to setup an admin role.");
        return;
    }
    if (!(await checkPermissions(interaction))) {
        await safeReply(interaction, "You must be on a partner server to setup an admin role.");
        return;
    }
    const role: Role = interaction.options.getRole("role", true) as Role;
    const guildID: string = interaction.guild.id;
    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get(
        "RoleAdmin",
        ["guild_id"],
        undefined,
        {query: "guild_id = ?", values: [guildID]});
    let status: status;
    if (result.length == 0) {
        status = await bdd.set("RoleAdmin", ["guild_id", "role_id"], [guildID, role.id]);
    } else {
        try {
            await bdd.update("RoleAdmin", {"role_id": role.id}, {"guild_id": guildID});
            status = {success: true, message: ""};
        } catch (e) {
            status = {success: false, message: "Update setBotAdminRole : " + (e as Error).message};
        }
    }
    if (!status.success) {
        await safeReply(interaction, "Failed to set the new admin role. Please try again.");
        await sendLog(client, status.message);
    } else {
        await safeReply(interaction, "Admin role set successfully !");
    }
}

export {setBotAdminRole};