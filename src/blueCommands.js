const getAdhesion = require("./getAdhesion");

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
                    type: 6,
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
    }
}

module.exports = blueCommands;