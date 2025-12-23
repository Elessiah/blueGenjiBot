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
import { areaFilter } from "../utils/globals.js";
import { rankChoices } from "./rankChoices.js";
import { servicesChoices } from "./servicesChoices.js";
const commands = {
    "help": {
        handler: printHelp,
        parameters: {
            description: "Send you in private the primary informations of the bot (EVERYONE)",
            options: [
                {
                    name: "language",
                    description: "The language you want to read",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        {
                            name: "English",
                            value: "en"
                        },
                        {
                            name: "Français",
                            value: "fr"
                        }
                    ]
                }
            ]
        }
    },
    "list-partner": {
        handler: listPartner,
        parameters: {
            description: "List all the servers with the service activated (EVERYONE)",
            options: [
                {
                    name: "service",
                    description: "Service you want to list",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: servicesChoices
                }
            ]
        }
    },
    "assign-channel": {
        handler: newChannelPartner,
        parameters: {
            description: "Assign a channel for the service you want activate (SERVER ADMIN ONLY)",
            options: [
                {
                    name: "channel",
                    description: "Channel you want to assign",
                    type: ApplicationCommandOptionType.Channel,
                    required: true
                },
                {
                    name: "service",
                    description: "Service you want to assign",
                    type: ApplicationCommandOptionType.String, // 3 for string
                    required: true,
                    choices: servicesChoices
                },
                {
                    name: "region-filter",
                    description: "Region you want to receive",
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                    choices: [
                        {
                            name: "All (No filter)",
                            value: areaFilter.ALL
                        },
                        {
                            name: "EU (Europe)",
                            value: areaFilter.EU
                        },
                        {
                            name: "NA (North America)",
                            value: areaFilter.NA
                        },
                        {
                            name: "LATAM (Latin America)",
                            value: areaFilter.LATAM
                        },
                        {
                            name: "ASIA",
                            value: areaFilter.ASIA
                        }
                    ]
                },
                {
                    name: "rank-min",
                    description: "The lowest rank you want to receive",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: rankChoices
                },
                {
                    name: "rank-max",
                    description: "The biggest rank you want to receive",
                    type: ApplicationCommandOptionType.String,
                    required: false,
                    choices: rankChoices
                }
            ]
        }
    },
    "edit-channel-filter-region": {
        handler: setChannelFilter,
        parameters: {
            description: "Edit the area that the channel receive (ADMIN ONLY)",
            options: [
                {
                    name: "channel",
                    description: "Channel you want to edit",
                    type: ApplicationCommandOptionType.Channel, // 7 for channel
                    required: true,
                },
                {
                    name: "region",
                    description: "Regional alert that you will now receive.",
                    type: ApplicationCommandOptionType.Integer,
                    required: true,
                    choices: [
                        {
                            name: "All (No filter)",
                            value: areaFilter.ALL
                        },
                        {
                            name: "EU (Europe)",
                            value: areaFilter.EU
                        },
                        {
                            name: "NA (North America)",
                            value: areaFilter.NA
                        },
                        {
                            name: "LATAM (Latin America)",
                            value: areaFilter.LATAM
                        },
                        {
                            name: "ASIA",
                            value: areaFilter.ASIA
                        }
                    ]
                }
            ]
        }
    },
    "display-channel-filter-region": {
        handler: displayChannelFilter,
        parameters: {
            description: "Display the channel region filter (EVERYONE)",
            options: [
                {
                    name: "channel",
                    description: "Channel you want to display filter",
                    type: ApplicationCommandOptionType.Channel,
                    required: true,
                }
            ]
        }
    },
    "edit-channel-filter-rank": {
        handler: setChannelRankFilter,
        parameters: {
            description: "Edit the rank filter of the channel",
            options: [
                {
                    name: "channel",
                    description: "Channel you want to edit",
                    type: ApplicationCommandOptionType.Channel,
                    required: true,
                },
                {
                    name: "rank-min",
                    description: "The lowest rank you want to receive",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: rankChoices
                },
                {
                    name: "rank-max",
                    description: "The biggest rank you want to receive",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: rankChoices
                }
            ]
        }
    },
    "display-channel-filter-rank": {
        handler: displayChannelRankFilter,
        parameters: {
            description: "Display the region rank filter (EVERYONE)",
            options: [
                {
                    name: "channel",
                    description: "Channel you want to display the filter",
                    type: ApplicationCommandOptionType.Channel,
                    required: true,
                }
            ]
        }
    },
    "reset-channel": {
        handler: resetChannel,
        parameters: {
            description: "Remove all the service of the channel (SERVER ADMIN ONLY)",
            options: [
                {
                    name: "channel",
                    description: "Channel you want to assign",
                    type: ApplicationCommandOptionType.Channel,
                    required: true
                }
            ]
        }
    },
    "reset-all": {
        handler: resetServer,
        parameters: {
            description: "Remove all the service of the server (SERVER ADMIN ONLY)",
        }
    },
    "ban-user-of-this-server": {
        handler: ban_id,
        parameters: {
            description: "Ban user from the bot services (ONLY SERVER 50+ members) (SERVER ADMIN ONLY)",
            options: [
                {
                    name: "user",
                    description: "User you want to ban",
                    type: ApplicationCommandOptionType.User,
                    required: true
                },
                {
                    name: "reason",
                    description: "Reason for the ban",
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        }
    },
    "ban-user-of-another-server": {
        handler: ban_username,
        parameters: {
            description: "Ban user from the bot services (ONLY SERVER 50+ members) (SERVER ADMIN ONLY)",
            options: [
                {
                    name: "username",
                    description: "Username of the user you want to ban",
                    type: ApplicationCommandOptionType.String,
                    required: true
                },
                {
                    name: "reason",
                    description: "Reason for the ban",
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        }
    },
    "ban-list": {
        handler: banlist,
        parameters: {
            description: "Display the list of banned members from the bot service (EVERYONE)",
        }
    },
    "unban": {
        handler: unban,
        parameters: {
            description: "Unban user from the bot service (ONLY SERVER 50+ members) (SERVER ADMIN ONLY)",
            options: [
                {
                    name: "id_ban",
                    description: "ID Ban you can find with the ban-list command",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                }
            ]
        }
    }
};
export { commands };
//# sourceMappingURL=commands.js.map