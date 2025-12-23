import { getAdhesion } from "../commandsHandlers/adhesions/getAdhesion.js";
import { broadcast } from "../commandsHandlers/broadcast.js";
import { contactAdminServer } from "../commandsHandlers/contactAdminServer.js";
import { remoteServerReset } from "../commandsHandlers/services/remoteServerReset.js";
import { restartBot } from "../commandsHandlers/restartBot.js";
import { ApplicationCommandOptionType } from "discord.js";
declare function fillBlueCommands(client: any): Promise<{
    "get-adhesion": {
        handler: typeof getAdhesion;
        parameters: {
            description: string;
            options: {
                name: string;
                description: string;
                type: number;
                required: boolean;
            }[];
        };
    };
    broadcast: {
        handler: typeof broadcast;
        parameters: {
            description: string;
            options: {
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
            }[];
        };
    };
    "contact-admin-server": {
        handler: typeof contactAdminServer;
        parameters: {
            description: string;
            options: ({
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices: import("../utils/types.js").ServerChoice[];
            } | {
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices?: undefined;
            })[];
        };
    };
    "remote-server-reset": {
        handler: typeof remoteServerReset;
        parameters: {
            description: string;
            options: {
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices: import("../utils/types.js").ServerChoice[];
            }[];
        };
    };
    "restart-bot": {
        handler: typeof restartBot;
        parameters: {
            description: string;
            options: {
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
            }[];
        };
    };
}>;
export { fillBlueCommands };
//# sourceMappingURL=fillBlueCommands.d.ts.map