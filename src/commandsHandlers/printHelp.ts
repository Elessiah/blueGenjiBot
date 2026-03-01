import {MessageFlags, Snowflake} from "discord.js";
import type { Client, ChatInputCommandInteraction } from "discord.js";
import fs from "node:fs/promises";
import {safeReply} from '../safe/safeReply.js';
import {sendLog} from "../safe/sendLog.js";
import {safeFollowUp} from "../safe/safeFollowUp.js";

async function printHelp(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    try {
        await interaction.deferReply({flags: MessageFlags.Ephemeral});
        const lang: string | null = interaction.options.getString("language");
        if (!lang) {
            await safeReply(interaction, "Missing parameter 'langage'. Please try again !");
            return;
        }
        let help: string;
        if (lang == "en")
            help = await fs.readFile('./help.md', 'utf8');
        else
            help = await fs.readFile('./helpfr.md', 'utf8');
        if (help.length > 2000) {
            const msgs: string[] = help.split("##");
            await safeReply(interaction, "Showing help in " + lang + " language", true, true);
            for (const msg of msgs) {
                await safeFollowUp(interaction, "##" + msg, true, []);
            }
        }
        else
            await safeReply(interaction, help, true, true);
    } catch (err) {
        await safeReply(interaction, (err as TypeError).message + "\n Please contact elessiah", true, true);
        await sendLog(client, "Print help error : \n" + (err as TypeError).message);
    }
}

export {printHelp};