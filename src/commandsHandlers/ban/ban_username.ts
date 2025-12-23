import type {ChatInputCommandInteraction, Client, User} from "discord.js";

import {safeReply} from "../../safe/safeReply.js";

import {ban} from "./ban.js";

async function ban_username(client: Client,
                            interaction: ChatInputCommandInteraction): Promise<boolean> {
    const username: string | null = interaction.options.getString("username");
    const reason: string | null = interaction.options.getString("reason");
    if (!username || !reason) {
        await safeReply(interaction, "Missing one or more parameter ! Please try again !");
        return false;
    }
    const user: User | undefined = client.users.cache.find(u => u.tag === username);
    if (!user) {
        await safeReply(interaction, "User was not find ! Please try again !");
        return true;
    }
    return await ban(client, interaction, user, reason);
}

export {ban_username};