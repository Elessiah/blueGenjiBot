import {Client, REST, Routes} from 'discord.js';
import 'dotenv/config';
import {globalCommands} from '../config/commands.js';
import {sendLog} from "../safe/sendLog.js";
import {describeError, isTransientNetworkError} from "../safe/errorGuards.js";

/**
 * Synchronise les commandes slash **globales** de l'application auprès de
 * Discord (`Routes.applicationCommands`), une fois au démarrage. Le `PUT`
 * remplace tout l'ensemble global : chaque commande globale doit figurer dans
 * `globalCommands`. Ne lève jamais, comme `updateCommands`.
 * @param client Client Discord utilisé pour le journal.
 * @param rest Client REST (injecté par les tests) ; par défaut, un client authentifié par `TOKEN`.
 */
async function updateGlobalCommands(client: Client, rest?: REST): Promise<void> {
    try {
        const { TOKEN, CLIENT_ID } = process.env;
        const api = rest ?? new REST({ version: "10" }).setToken(TOKEN!);
        await api.put(Routes.applicationCommands(CLIENT_ID!), {
            body: Object.entries(globalCommands).map(([name, command]) => ({ name, ...command.parameters })),
        });
    } catch (error) {
        const description = `Update Global Commands : \n ${describeError(error)}`;
        // Une panne réseau passagère reste sur la console : `sendLog` passerait
        // par le réseau même qui est tombé.
        let transient = false;
        try {
            transient = isTransientNetworkError(error);
        } catch { /* valeur illisible : traitée comme une vraie faute */ }
        if (transient) {
            console.warn(description);
        } else {
            await sendLog(client, description);
        }
    }
}

export {updateGlobalCommands};
