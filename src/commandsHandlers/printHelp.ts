import {MessageFlags} from "discord.js";
import type { Client, ChatInputCommandInteraction } from "discord.js";
import fs from "node:fs/promises";
import {safeReply} from '../safe/safeReply.js';
import {sendLog} from "../safe/sendLog.js";
import {safeFollowUp} from "../safe/safeFollowUp.js";
import {splitForDiscord} from "../utils/splitForDiscord.js";

/**
 * Affiche l'aide contextualisee des commandes disponibles.
 * @param client Client Discord utilise pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function printHelp(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    try {
        await interaction.deferReply({flags: MessageFlags.Ephemeral});
        const lang: string | null = interaction.options.getString("language");

        if (!lang) {
            await safeReply(interaction, "Missing parameter 'language'. Please try again!", true, true);
            return;
        }

        const helpPath = lang === "en" ? "./help.md" : "./helpfr.md";
        const help = await fs.readFile(helpPath, "utf8");
        const chunks = splitForDiscord(help);

        if (chunks.length === 0) {
            await safeReply(interaction, "Help content is currently unavailable. Please try again later.", true, true);
            return;
        }

        if (chunks.length === 1) {
            await safeReply(interaction, chunks[0], true, true);
            return;
        }

        const languageLabel = lang === "fr" ? "French" : "English";
        await safeReply(
            interaction,
            `Showing help in ${languageLabel} (${chunks.length} messages).`,
            true,
            true
        );

        for (const chunk of chunks) {
            await safeFollowUp(interaction, chunk, true, []);
        }
    } catch (err) {
        await safeReply(interaction, (err as TypeError).message + "\nPlease contact elessiah", true, true);
        await sendLog(client, "Print help error:\n" + (err as TypeError).message);
    }
}

export {printHelp};
