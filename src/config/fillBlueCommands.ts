import {getAdhesion} from "../commandsHandlers/adhesions/getAdhesion.js";
import {broadcast} from "../commandsHandlers/broadcast.js";
import {buildServerChoices} from "../utils/buildServerChoices.js";
import {contactAdminServer} from "../commandsHandlers/contactAdminServer.js";
import {remoteServerReset} from "../commandsHandlers/services/remoteServerReset.js";
import {restartBot} from "../commandsHandlers/restartBot.js";
import {ApplicationCommandOptionType} from "discord.js";

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
                        type: ApplicationCommandOptionType.String, // 3 for string
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
                    },
                    {
                        name: "interval",
                        description: "Intervalle en jour pour renvoi automatique, 20 jours max",
                        type: ApplicationCommandOptionType.String,
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
                        type: ApplicationCommandOptionType.String,
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
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: serverChoices,
                    },
                    {
                        name: "message",
                        description: "Content of your message",
                        type: ApplicationCommandOptionType.String,
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
                        type: ApplicationCommandOptionType.String,
                        required: true,
                        choices: serverChoices,
                    }
                ]
            }
        },
        "restart-bot": {
            handler: restartBot,
            parameters: {
                description: "Restart bot and update it (Ne marche pas et éteint le BOT!!)",
                options: [
                    {
                        name: "password",
                        description: "Password, le grand amour d'Elessiah",
                        type: ApplicationCommandOptionType.String,
                        required: true,
                    }
                ]
            }
        }
    };
    return blueCommands;
}
/*
,
        "show-programmed-rappel-adhesion": {
            handler: displaySetupAdhesion,
            parameters: {
                descriptions: "Affiche les programmation de rappel d'adhésion"
            }
        },
        "delete-programmed-rappel-adhesion": {
          handler: deleteSetupAdhesion,
          parameters: {
              descriptions: "Supprime une programmation de rappel d'adhésion",
              options: [
                  {
                      name: "id-rappel",
                      description: "ID du rappel, voir la commande /display-programmed-rappel-adhesion",
                      type: ApplicationCommandOptionType.String,
                      required: true
                  }
              ]
          }
        }
 */
export { fillBlueCommands };