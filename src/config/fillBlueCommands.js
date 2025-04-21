const getAdhesion = require("../commandsHandlers/getAdhesion");
const broadcast = require("../commandsHandlers/broadcast");
const buildServerChoices = require("../utils/buildServerChoices");
const contactAdminServer = require("../commandsHandlers/contactAdminServer");
const remoteServerReset = require("../commandsHandlers/services/remoteServerReset");
const restartBot = require("../commandsHandlers/restartBot");

async function fillBlueCommands(client) {
    const serverChoices = await buildServerChoices(client);
    const blueCommands = {
        "get-adhesion": {
            handler: getAdhesion,
            parameters: {
                description: "Envoie l'adhésion (Disponible uniquement sur les serveurs BlueGenji)",
                options: [
                    {
                        name: "message",
                        description: "Message d'accompagnement",
                        type: 3, // 3 for string
                        required: false
                    },
                    {
                        name: "channel",
                        description: "Channel à envoyer l'adhésion",
                        type: 7, // 7 for channel
                        required: false
                    },
                    {
                        name: "membre",
                        description: "Membre à envoyer l'adhésion",
                        type: 6, // 6 membre
                        required: false
                    },
                    {
                        name: "role",
                        description: "Role à envoyer l'adhésion",
                        type: 8, // 8 for role
                        required: false
                    }
                ]
            }
        },
        "broadcast": {
            handler: broadcast,
            parameters: {
                description: "Send a message on all services. Use with precautions ! (Admin only)",
                options: [
                    {
                        name: "message",
                        description: "Broadcast message",
                        type: 3,
                        required: true
                    }
                ]
            }
        },
        "contact-admin-server": {
            handler: contactAdminServer,
            parameters: {
                description: "Send a message to the admins of a specific server using the bot (Admin only)",
                options: [
                    {
                        name: "server",
                        description: "Server targeted",
                        type: 3,
                        required: true,
                        choices: serverChoices,
                    },
                    {
                        name: "message",
                        description: "Content of your message",
                        type: 3,
                        required: true,
                    }
                ]
            }
        },
        "remote-server-reset": {
            handler: remoteServerReset,
            parameters: {
                description: "Admin only ! Remotely reset a server",
                options: [
                    {
                        name: "server",
                        description: "Server targeted",
                        type: 3,
                        required: true,
                        choices: serverChoices,
                    }
                ]
            }
        },
        "restart-bot": {
            handler: restartBot,
            parameters: {
                description: "Restart bot and update it",
                options: [
                    {
                        name: "password",
                        description: "Password, le grand amour d'Elessiah",
                        type: 3,
                        required: true,
                    }
                ]
            }
        }
    };
    return blueCommands;
}

module.exports = fillBlueCommands;