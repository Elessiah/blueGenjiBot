import {Client, REST, Routes} from 'discord.js';
import 'dotenv/config';
import {commands} from '../config/commands.js';
import {fillBlueCommands} from '../config/fillBlueCommands.js';
import {sendLog} from "../safe/sendLog.js";
import {describeError} from "../safe/errorGuards.js";

/**
 * Synchronise les commandes slash de l'application auprès de Discord.
 * @param client Client Discord utilisé pour les appels API.
 * @param guildId Identifiant du serveur cible (utilisé en appel interne sans interaction).
 */
async function updateCommands(client: Client,
                              guildId: string): Promise<void> {
    // Tout sous la même garde, préparation comprise : la fonction ne lève
    // jamais, si bien qu'un serveur en échec ne prive ni les suivants de leurs
    // commandes ni le démarrage de ce qui suit (tâches cron, assistant
    // d'installation), quel que soit l'appelant.
    try {
        const { TOKEN, CLIENT_ID, SERV_GENJI, SERV_RIVALS } = process.env;
        const rest = new REST({ version: "10" }).setToken(TOKEN!);
        let installCommands = {};
        if (guildId === SERV_GENJI || guildId === SERV_RIVALS) {
            installCommands = Object.assign({}, commands, await fillBlueCommands(client));
        } else {
            installCommands = commands;
        }
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
        // Comme avant, au journal (un 50001 dit une invitation sans le droit
        // `applications.commands`, à corriger) ; `sendLog` ne lève pas.
        await sendLog(client, `Update Commands (serveur ${guildId}) : \n ${describeError(error)}`);
    }
}

export {updateCommands};
