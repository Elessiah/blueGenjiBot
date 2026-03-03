import {safeReply} from "../safe/safeReply.js";
import pm2 from "pm2";
import { spawn } from "child_process";
import type {Client, ChatInputCommandInteraction} from "discord.js";
import {YesNo} from "@/utils/globals.js";

function strictRestart() {
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
}

function updateRestart() {
    setTimeout(() => {
        const child = spawn(
            "bash",
            ["/home/elessiah/work/blueGenjiBot/updateBot.sh"],
            {
                detached: true,
                stdio: "ignore",
            }
        );

        child.unref();
    }, 1000);
}

async function restartBot(client: Client,
                          interaction: ChatInputCommandInteraction): Promise<void> {
    const userTry: string | null = interaction.options.getString("password");
    const userChoice: number | null = interaction.options.getInteger("update");
    if (!userTry || userChoice === null) {
        await safeReply(interaction, "Missing parameter 'password' or 'update' ! Please try again.");
        return;
    }
    if (process.env.PASSWORD === userTry) {
        await safeReply(interaction, "See you soon ! Restarting...");
        if (userChoice == YesNo.NO) {
            strictRestart();
        } else {
            await safeReply(interaction, "Mettre à jour ne fonctionne pas pour le moment. Essaie le redémarrage seule.");
            // updateRestart();
        }
    } else {
        await safeReply(interaction, "Wrong password ! Are you sure you have right to do this ?");
    }
}

export {restartBot};