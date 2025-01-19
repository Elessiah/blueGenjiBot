const { CacheType, ChatInputCommandInteraction } = require("discord.js");
const newChannelPartner = require("./newChannelPartner.js");
const { resetChannel } = require("./resetChannel");
const {resetServer} = require("./resetServer");
const printHelp = require("./printHelp");
const {listPartner} = require("./listPartner");

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
    }
}

module.exports = commands;