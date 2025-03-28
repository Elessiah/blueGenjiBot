const { CacheType, ChatInputCommandInteraction, ApplicationCommandOptionType } = require("discord.js");
const newChannelPartner = require("../commandsHandlers/services/newChannelPartner.js");
const { resetChannel } = require("../commandsHandlers/services/resetChannel");
const {resetServer} = require("../commandsHandlers/services/resetServer");
const printHelp = require("../commandsHandlers/printHelp");
const {listPartner} = require("../commandsHandlers/services/listPartner");
const ban = require("../commandsHandlers/ban/ban");
const banlist = require("../commandsHandlers/ban/banlist");
const unban = require("../commandsHandlers/ban/unban");
const {areaFilter} = require("../utils/enums");
const setChannelFilter = require("../commandsHandlers/services/setChannelFilter");
const displayChannelFilter = require("../commandsHandlers/services/displayChannelFilter");

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
                    choices: [
                        {
                            name: "LookForScrim",
                            value: "lfs"
                        },
                        {
                            name: "TournamentAnnouncement",
                            value: "ta"
                        },
                        {
                            name: "LookForSub",
                            value: "lfsub"
                        },
                        {
                            name: "LookForTeam",
                            value: "lft"
                        },
                        {
                            name: "LookForPlayer",
                            value: "lfp"
                        },
                        {
                            name: "LookForStaff",
                            value: "lfstaff"
                        },
                        {
                            name: "LookForCast",
                            value: "lfcast"
                        }
                    ]
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
                    choices: [
                        {
                            name: "LookForScrim",
                            value: "lfs"
                        },
                        {
                            name: "TournamentAnnouncement",
                            value: "ta"
                        },
                        {
                            name: "LookForSub",
                            value: "lfsub"
                        },
                        {
                            name: "LookForTeam",
                            value: "lft"
                        },
                        {
                            name: "LookForPlayer",
                            value: "lfp"
                        },
                        {
                            name: "LookForStaff",
                            value: "lfstaff"
                        },
                        {
                            name: "LookForCast",
                            value: "lfcast"
                        }
                    ]
                },
                {
                    name: "filter",
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
                }
            ]
        }
    },
    "edit-channel-filter": {
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
    "display-channel-filter": {
      handler: displayChannelFilter,
      parameters: {
          description: "Display channel filter (EVERYONE)",
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
    "ban": {
        handler: ban,
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
}

module.exports = commands;