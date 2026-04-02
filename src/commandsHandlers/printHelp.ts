import {MessageFlags} from "discord.js";
import type { Client, ChatInputCommandInteraction } from "discord.js";
import fs from "node:fs/promises";
import {safeReply} from '../safe/safeReply.js';
import {sendLog} from "../safe/sendLog.js";
import {safeFollowUp} from "../safe/safeFollowUp.js";

const DISCORD_MESSAGE_MAX_LENGTH = 2000;
const HELP_CHUNK_MAX_LENGTH = 1900;

/**
 * Decoupe un texte long en blocs adaptes a Discord, en priorisant les paragraphes.
 * @param content Texte a envoyer.
 * @param maxLength Taille maximale d'un bloc.
 * @returns Liste de blocs tous <= maxLength.
 */
function splitForDiscord(content: string, maxLength: number = HELP_CHUNK_MAX_LENGTH): string[] {
    const normalized = content.replace(/\r\n/g, "\n").trim();
    if (normalized.length <= maxLength) {
        return [normalized];
    }

    const chunks: string[] = [];
    let current = "";

    const flushCurrent = (): void => {
        if (current.length > 0) {
            chunks.push(current);
            current = "";
        }
    };

    const pushLineSafely = (line: string): void => {
        if (line.length <= maxLength) {
            if (current.length === 0) {
                current = line;
            } else if ((current + "\n" + line).length <= maxLength) {
                current += "\n" + line;
            } else {
                flushCurrent();
                current = line;
            }
            return;
        }

        let remaining = line;
        while (remaining.length > 0) {
            const slice = remaining.slice(0, maxLength);
            const lastSpace = slice.lastIndexOf(" ");
            const cutIndex = lastSpace > 0 ? lastSpace : maxLength;
            const part = remaining.slice(0, cutIndex).trim();

            if (part.length > 0) {
                if (current.length > 0) {
                    flushCurrent();
                }
                chunks.push(part);
            }
            remaining = remaining.slice(cutIndex).trimStart();
        }
    };

    const paragraphs = normalized.split("\n\n");
    for (const paragraph of paragraphs) {
        if (paragraph.length === 0) {
            continue;
        }

        if (paragraph.length <= maxLength) {
            if (current.length === 0) {
                current = paragraph;
            } else if ((current + "\n\n" + paragraph).length <= maxLength) {
                current += "\n\n" + paragraph;
            } else {
                flushCurrent();
                current = paragraph;
            }
            continue;
        }

        const lines = paragraph.split("\n");
        for (const line of lines) {
            pushLineSafely(line);
        }
    }

    flushCurrent();

    return chunks.filter((chunk) => chunk.length > 0 && chunk.length <= DISCORD_MESSAGE_MAX_LENGTH);
}

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
