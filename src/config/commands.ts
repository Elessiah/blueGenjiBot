import {ApplicationCommandOptionType} from "discord.js";

import {ban_id} from "../commandsHandlers/ban/ban_id.js";
import {ban_username} from "../commandsHandlers/ban/ban_username.js";
import {banlist} from "../commandsHandlers/ban/banlist.js";
import {unban} from "../commandsHandlers/ban/unban.js";
import {printHelp} from "../commandsHandlers/printHelp.js";
import {displayChannelFilter} from "../commandsHandlers/services/displayChannelFilter.js";
import {displayChannelRankFilter} from "../commandsHandlers/services/displayChannelRankFilter.js";
import {listPartner} from "../commandsHandlers/services/listPartner.js";
import {newChannelPartner} from "../commandsHandlers/services/newChannelPartner.js";
import {resetChannel} from "../commandsHandlers/services/resetChannel.js";
import {resetServer} from "../commandsHandlers/services/resetServer.js";
import {setChannelFilter} from "../commandsHandlers/services/setChannelFilter.js";
import {setChannelRankFilter} from "../commandsHandlers/services/setChannelRankFilter.js";
import {areaFilter} from "../utils/globals.js";

import {rankChoices} from "./rankChoices.js";
import {servicesChoices} from "./servicesChoices.js";
import {setBotAdminRole} from "@/commandsHandlers/admin/setBotAdminRole.js";
import {showBotAdminRole} from "@/commandsHandlers/admin/showBotAdminRole.js";
import {ping} from "../commandsHandlers/ping.js";
import {scrim} from "../commandsHandlers/scrim.js";
import {recrute} from "../commandsHandlers/recrute.js";
import {link} from "../commandsHandlers/link.js";
import {statsPlayer} from "../commandsHandlers/statsPlayer.js";
import {relay} from "../commandsHandlers/admin/relay.js";
import {configModule} from "../commandsHandlers/admin/configModule.js";

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
    },
    "set-bot-admin": {
        handler: setBotAdminRole,
        parameters: {
            description: "Sets the bot admin role",
            options: [
                {
                    name: "role",
                    description: "Role admin for the bot service",
                    type: ApplicationCommandOptionType.Role,
                    required: true,
                }
            ]
        }
    },
    "show-bot-admin": {
        handler: showBotAdminRole,
        parameters: {
            description: "Display the bot admin role",
        }
    },
    "ping": {
        handler: ping,
        parameters: {
            description: "Verifie la latence du bot (TOUS)"
        }
    },
    "scrim": {
        handler: scrim,
        parameters: {
            description: "Propose une equipe pour un scrim (TOUS)",
            options: [
                {
                    name: "jeu",
                    description: "Jeu pour le scrim",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: "Marvel Rivals", value: "marvel_rivals" },
                        { name: "Overwatch 2", value: "overwatch2" }
                    ]
                },
                {
                    name: "niveau",
                    description: "Niveau (debutant, intermediaire, avance...)",
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        }
    },
    "recrute": {
        handler: recrute,
        parameters: {
            description: "Publie une recherche d'equipe ou staff (TOUS)",
            options: [
                {
                    name: "role",
                    description: "Role recherche",
                    type: ApplicationCommandOptionType.String,
                    required: true
                }
            ]
        }
    },
    "link": {
        handler: link,
        parameters: {
            description: "Lie ton compte Discord au site BlueGenji (TOUS)"
        }
    },
    "stats": {
        handler: statsPlayer,
        parameters: {
            description: "Affiche les stats 30j d'un joueur (TOUS)",
            options: [
                {
                    name: "joueur",
                    description: "Joueur (optionnel, sinon vous-meme)",
                    type: ApplicationCommandOptionType.User,
                    required: false
                }
            ]
        }
    },
    "relay": {
        handler: relay,
        parameters: {
            description: "Configure ou retire un salon de relais (ADMIN UNIQUEMENT)",
            options: [
                {
                    name: "channel",
                    description: "Salon a configurer",
                    type: ApplicationCommandOptionType.Channel,
                    required: true
                }
            ]
        }
    },
    "config": {
        handler: configModule,
        parameters: {
            description: "Active/desactive un module sur ce serveur (ADMIN UNIQUEMENT)",
            options: [
                {
                    name: "module",
                    description: "Module a basculer",
                    type: ApplicationCommandOptionType.String,
                    required: true,
                    choices: [
                        { name: "Annonces", value: "annonces" },
                        { name: "Scrims", value: "scrims" },
                        { name: "Recrutement", value: "recrutement" },
                        { name: "Notifications", value: "notifications" },
                        { name: "Stats", value: "stats" }
                    ]
                }
            ]
        }
    }
}

export {commands};
