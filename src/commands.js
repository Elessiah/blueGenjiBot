const { CacheType, ChatInputCommandInteraction } = require("discord.js");
const newChannelPartner = require("./newChannelPartner.js");
const resetChannel = require("./resetChannel");
const {resetServer} = require("./resetServer");
const printHelp = require("./printHelp");

const commands = {
    "help": {
      handler: printHelp,
      parameters: {
        description: "Print the primary informations of the bot",
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
    "assign-channel": {
        handler: newChannelPartner,
        parameters: {
            description : "Assign a channel for the service you want activate (SERVER ADMIN ONLY)",
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