import {safeReply} from "../safe/safeReply.js";
import pm2 from "pm2";

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
        setTimeout(() => {
            pm2.connect((err) => {
                if (err) {
                    console.error(err);
                    process.exit(2);
                }

                pm2.restart("BlueGenjiBot", (err) => {
                    pm2.disconnect();
                    if (err) console.error(err);
                });
            });
        }, 1000);
    } else {
        await safeReply(interaction, "Wrong password ! Are you sure you have right to do this ?");
    }
}

export {restartBot};