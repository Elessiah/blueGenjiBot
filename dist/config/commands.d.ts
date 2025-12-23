import { ApplicationCommandOptionType } from "discord.js";
import { ban_id } from "../commandsHandlers/ban/ban_id.js";
import { ban_username } from "../commandsHandlers/ban/ban_username.js";
import { banlist } from "../commandsHandlers/ban/banlist.js";
import { unban } from "../commandsHandlers/ban/unban.js";
import { printHelp } from "../commandsHandlers/printHelp.js";
import { displayChannelFilter } from "../commandsHandlers/services/displayChannelFilter.js";
import { displayChannelRankFilter } from "../commandsHandlers/services/displayChannelRankFilter.js";
import { listPartner } from "../commandsHandlers/services/listPartner.js";
import { newChannelPartner } from "../commandsHandlers/services/newChannelPartner.js";
import { resetChannel } from "../commandsHandlers/services/resetChannel.js";
import { resetServer } from "../commandsHandlers/services/resetServer.js";
import { setChannelFilter } from "../commandsHandlers/services/setChannelFilter.js";
import { setChannelRankFilter } from "../commandsHandlers/services/setChannelRankFilter.js";
declare const commands: {
    help: {
        handler: typeof printHelp;
        parameters: {
            description: string;
            options: {
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices: {
                    name: string;
                    value: string;
                }[];
            }[];
        };
    };
    "list-partner": {
        handler: typeof listPartner;
        parameters: {
            description: string;
            options: {
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices: {
                    name: string;
                    value: string;
                }[];
            }[];
        };
    };
    "assign-channel": {
        handler: typeof newChannelPartner;
        parameters: {
            description: string;
            options: ({
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices?: undefined;
            } | {
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices: {
                    name: string;
                    value: string;
                }[];
            } | {
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices: ({
                    name: string;
                    value: 0;
                } | {
                    name: string;
                    value: 1;
                } | {
                    name: string;
                    value: 2;
                } | {
                    name: string;
                    value: 3;
                } | {
                    name: string;
                    value: 4;
                })[];
            })[];
        };
    };
    "edit-channel-filter-region": {
        handler: typeof setChannelFilter;
        parameters: {
            description: string;
            options: ({
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices?: undefined;
            } | {
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices: ({
                    name: string;
                    value: 0;
                } | {
                    name: string;
                    value: 1;
                } | {
                    name: string;
                    value: 2;
                } | {
                    name: string;
                    value: 3;
                } | {
                    name: string;
                    value: 4;
                })[];
            })[];
        };
    };
    "display-channel-filter-region": {
        handler: typeof displayChannelFilter;
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
    "edit-channel-filter-rank": {
        handler: typeof setChannelRankFilter;
        parameters: {
            description: string;
            options: ({
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices?: undefined;
            } | {
                name: string;
                description: string;
                type: ApplicationCommandOptionType;
                required: boolean;
                choices: {
                    name: string;
                    value: string;
                }[];
            })[];
        };
    };
    "display-channel-filter-rank": {
        handler: typeof displayChannelRankFilter;
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
    "reset-channel": {
        handler: typeof resetChannel;
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
    "reset-all": {
        handler: typeof resetServer;
        parameters: {
            description: string;
        };
    };
    "ban-user-of-this-server": {
        handler: typeof ban_id;
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
    "ban-user-of-another-server": {
        handler: typeof ban_username;
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
    "ban-list": {
        handler: typeof banlist;
        parameters: {
            description: string;
        };
    };
    unban: {
        handler: typeof unban;
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
};
export { commands };
//# sourceMappingURL=commands.d.ts.map