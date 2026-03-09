import {ChatInputCommandInteraction, Client} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";

async function showBotAdminRole(client: Client,
                                interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await safeReply(interaction, "There is no admin role outside discord server.");
        return;
    }
    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get("RoleAdmin", ["role_id"], undefined, {query: "guild_id = ?", values: [interaction.guild.id]});
    if (result.length == 0) {
        await safeReply(interaction, "There is no admin role on this discord server.");
        return;
    }
    const role: {role_id: string} = result[0] as {role_id: string};
    await safeReply(interaction, "The admin role for the bot is <@&" + role.role_id + ">");
}

export {showBotAdminRole};
