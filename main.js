require('dotenv').config();
const { Client, GatewayIntentBits } = require("discord.js");
const {getBddInstance} = require("./src/Bdd");
const {updateCommands} = require("./src/updateCommands.js");
const commands = require("./src/commands");
const manageDistribution = require("./src/manageDistribution");
const {_resetServer} = require("./src/resetServer");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, // Nécessaire pour recevoir les événements des serveurs (guilds)
        GatewayIntentBits.GuildMessages, // Pour les messages
        GatewayIntentBits.MessageContent  // Pour accéder au contenu des messages
    ],
});

const ownerId = process.env.OWNER_ID;

client.on("interactionCreate", async interaction => {
    if (!interaction.isCommand() || !interaction)
        return;
    const { commandName } = interaction;
    const command = commands[commandName];
    if (!command) {
        interaction.reply({ content: 'Command not found', ephemeral: true });
        return;
    }
    command.handler(interaction, interaction.guildId);
});

client.on("messageCreate", async message => {
    if (message.author.bot || message.author.system) return;
    const { channelId } = message;
    const bdd = await getBddInstance();
    let services = await bdd.get("ChannelPartnerService",
        ["Service.name"],
        {"Service":"ChannelPartnerService.id_service = Service.id_service",
        "ChannelPartner":"ChannelPartnerService.id_channel = ChannelPartner.id_channel"},
        {"ChannelPartner.id_channel": channelId}
    );
    if (services.length > 0) {
        await manageDistribution(message, client, bdd, channelId, services);
    }
})

client.on("ready", async () => {
    for (const guild of client.guilds.cache.values()) {
        await updateCommands(guild.id);
    }
    const owner = await client.users.fetch(ownerId);
    try {
        await owner.send('Bot is ready!');
    } catch (error) {
        console.error('Failed to send message to owner:', error);
    }
});

client.on("guildCreate", async guild => {
    await updateCommands(guild.id);
    const owner = await client.users.fetch(ownerId);
    await owner.send('Bot has join a new server : ' + guild.name);
});

client.on("guildDelete", async guild => {
    await _resetServer(guild.id);
})

client.login(process.env.TOKEN);