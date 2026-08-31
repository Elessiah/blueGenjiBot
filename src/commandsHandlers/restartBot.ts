import {safeReply} from "../safe/safeReply.js";
import pm2 from "pm2";
import type {Client, ChatInputCommandInteraction} from "discord.js";

/**
 * Relance le bot via PM2.
 */
function restartProcess() {
    /**
     * Callback différé qui relance le processus PM2.
     */

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

/**
 * Redémarre le bot après vérification du mot de passe.
 * @param _client Client Discord (non utilisé, signature commune aux handlers).
 * @param interaction Interaction utilisateur en cours.
 */
async function restartBot(_client: Client,
                          interaction: ChatInputCommandInteraction): Promise<void> {
    const userTry: string | null = interaction.options.getString("password");
    if (!userTry) {
        await safeReply(interaction, "Missing parameter 'password' ! Please try again.");
        return;
    }
    if (process.env.PASSWORD === userTry) {
        await safeReply(interaction, "See you soon ! Restarting...");
        restartProcess();
    } else {
        await safeReply(interaction, "Wrong password ! Are you sure you have right to do this ?");
    }
}

export {restartBot};
