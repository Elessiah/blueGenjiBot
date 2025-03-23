const { REST, Routes } = require('discord.js');
require('dotenv').config();
const commands = require('./commands.js');
const fillBlueCommands = require('./fillBlueCommands.js');
const sendLog = require("./safe/sendLog");

const updateCommands = async(client, guildId) => {
    const { TOKEN, CLIENT_ID, SERV_GENJI, SERV_RIVALS } = process.env;
    const rest = new REST({ version: "10" }).setToken(TOKEN);
    let installCommands = {};
    if (guildId === SERV_GENJI || guildId === SERV_RIVALS) {
        installCommands = Object.assign({}, commands, await fillBlueCommands(client));
    } else {
        installCommands = commands;
    }
    try {
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, guildId),
            {
                body: Object.keys(installCommands).map((command) => {
                    return {
                        name: command,
                        ...installCommands[command].parameters,
                    };
                }),
            }
        );
    } catch (error) {
        await sendLog(client, "Update Commands : \n " + error.message);
    }
}

module.exports = {updateCommands};