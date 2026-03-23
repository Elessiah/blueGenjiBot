import {Client, REST, Routes} from 'discord.js';
import 'dotenv/config';
import {commands} from '../config/commands.js';
import {fillBlueCommands} from '../config/fillBlueCommands.js';
import {sendLog} from "../safe/sendLog.js";

/**
 * Synchronise les commandes slash de l'application auprès de Discord.
 * @param client Client Discord utilisé pour les appels API.
 * @param guildId Identifiant du serveur cible (utilisé en appel interne sans interaction).
 */
async function updateCommands(client: Client,
                              guildId: string): Promise<void> {
    const { TOKEN, CLIENT_ID, SERV_GENJI, SERV_RIVALS } = process.env;
    const rest = new REST({ version: "10" }).setToken(TOKEN!);
    let installCommands = {};
    if (guildId === SERV_GENJI || guildId === SERV_RIVALS) {
        installCommands = Object.assign({}, commands, await fillBlueCommands(client));
    } else {
        installCommands = commands;
    }
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID!, guildId),
            {
                body: Object.keys(installCommands).map((command) => {
                    return {
                        name: command,
                        ...installCommands[command].parameters,
                    };
                }),
            }
        );
    } catch (error) {
        await sendLog(client, "Update Commands : \n " + (error as TypeError).message);
    }
}

export {updateCommands};
