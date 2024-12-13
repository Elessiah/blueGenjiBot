require('dotenv').config();
const { EmbedBuilder, REST, TextChannel } = require("discord.js");
const { Client, GatewayIntentBits } = require("discord.js");
const {getBddInstance} = require("./src/Bdd");
const updateCommands = require("./src/updateCommands.js");
const commands = require("./src/commands");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, // Nécessaire pour recevoir les événements des serveurs (guilds)
        GatewayIntentBits.GuildMessages, // Pour les messages
        GatewayIntentBits.MessageContent  // Pour accéder au contenu des messages
    ],
});

const ownerId = '390973051367587850';

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
    bdd = await getBddInstance();
    let services = await bdd.getChannelService(channelId);
    console.log(services);
    if (!services.success)
        return;
    services = services.message;
    console.log(services);
    for (const service of services) {
        if (message.content.toLowerCase().includes(service)) {
            const targets = await bdd.getPartnerChannelsFromServiceId(service);
            for (const target of targets) {
                const channel = await client.channels.fetch(target);
                const embed = new EmbedBuilder().setAuthor({
                    name: message.author.username,
                    iconURL: message.author.displayAvatarURL(),
                }).setDescription(message.content);
                await channel.send({ embeds: [embed] });
            }
        }
    }
})

client.on("ready", async () => {
    bdd = await getBddInstance();
    for (const guild of client.guilds.cache.values()) {
        await updateCommands(guild.id);
        console.log(`guid id : ${guild.id}`)
        console.log(`bot is ready on ${guild.name}`);
    }
    const owner = await client.users.fetch(ownerId);
    try {
        await owner.send('Bot is ready!');
    } catch (error) {
        console.error('Failed to send message to owner:', error);
    }
});

client.login(process.env.TOKEN);