import {safeReply} from "../safe/safeReply.js";
import {exec} from "child_process";

import type {Client, ChatInputCommandInteraction} from "discord.js";

async function restartBot(client: Client,
                          interaction: ChatInputCommandInteraction): Promise<void> {
    const userTry: string | null = interaction.options.getString("password");
    if (!userTry) {
        await safeReply(interaction, "Missing parameter 'password' ! Please try again.");
        return;
    }
    if (process.env.PASSWORD === userTry) {
        await safeReply(interaction, "See you soon ! Restarting...");
        exec('reboot');
    } else {
        await safeReply(interaction, "Wrong password ! Are you sure you have right to do this ?");
    }
}

export {restartBot};