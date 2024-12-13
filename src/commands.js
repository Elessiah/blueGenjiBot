const { CacheType, ChatInputCommandInteraction } = require("discord.js");
const updateCommands = require("./updateCommands.js");
const newChannelPartner = require("./newChannelPartner.js");

const commands = {
    "update-commands": {
        handler: updateCommands,
        parameters: {
            description : "Refresh the commands"
        }
    },
    "assign-channel": {
        handler: newChannelPartner,
        parameters: {
            description : "Assign a channel for the service you want activate",
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
                            name: "LookForCompetition",
                            value: "lfc"
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
    }
}

module.exports = commands;