const { CacheType, ChatInputCommandInteraction } = require("discord.js");
const newChannelPartner = require("./newChannelPartner.js");
const { resetChannel } = require("./resetChannel");
const {resetServer} = require("./resetServer");
const printHelp = require("./printHelp");
const {listPartner} = require("./listPartner");
const ban = require("./ban");
const banlist = require("./banlist");
const unban = require("./unban");

const commands = {
    "help": {
        handler: printHelp,
        parameters: {
            description: "Send you in private the primary informations of the bot (EVERYONE)",
            options: [
                {
                    name: "language",
                    description: "The language you want to read",
                    type: 3,
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
                    type: 3,
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
                    type: 7, // 7 for channel
                    required: true
                },
                {
                    name: "service",
                    description: "Service you want to assign",
                    type: 3, // 3 for string
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
    "reset-channel": {
        handler: resetChannel,
        parameters: {
            description: "Remove all the service of the channel (SERVER ADMIN ONLY)",
            options: [
                {
                    name: "channel",
                    description: "Channel you want to assign",
                    type: 7, // 7 for channel
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
                    type: 6,
                    required: true
                },
                {
                    name: "reason",
                    description: "Reason for the ban",
                    type: 3,
                    required: true
                }
            ]
        }
    },
    "ban-list": {
        handler: banlist,
        parameters: {
            description: "Display the list of banned members from the bot service",
        }
    },
    "unban": {
        handler: unban,
        parameters: {
            description: "Unban user from the bot service",
            options: [
                {
                    name: "id_ban",
                    description: "ID Ban you can find with the ban-list command",
                    type: 3,
                    required: true,
                }
            ]
        }
    }
}

module.exports = commands;