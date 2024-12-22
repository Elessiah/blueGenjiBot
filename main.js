require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder} = require("discord.js");
const {getBddInstance} = require("./src/Bdd");
const {updateCommands} = require("./src/updateCommands.js");
const commands = require("./src/commands");
const manageDistribution = require("./src/manageDistribution");
const {_resetServer} = require("./src/resetServer");
const sendLog = require("./src/safe/sendLog");
const safeReply = require("./src/safe/safeReply");
const {_resetChannel} = require("./src/resetChannel");

const client = new Client({
            intents: [
                GatewayIntentBits.Guilds, // Nécessaire pour recevoir les événements des serveurs (guilds)
                GatewayIntentBits.GuildMessages, // Pour les messages
                GatewayIntentBits.MessageContent  // Pour accéder au contenu des messages
            ],
        });

client.on("interactionCreate", async interaction => {
    if (!interaction.isCommand() || !interaction)
        return;
    const { commandName } = interaction;
    const command = commands[commandName];
    if (!command) {
        return await safeReply("Command not found");
    }
    await command.handler(client, interaction, interaction.guildId);
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

client.on("messageUpdate", async (oldMessage, newMessage) => {
    const bdd = await getBddInstance();
    let DPMsgs = await bdd.get("DPMsg", ["id_msg", "id_channel"], {}, {"id_og": oldMessage.id});
    if (DPMsgs.length > 0) {
        let embed;
        if (oldMessage.attachments.size === 1
        && newMessage.attachments.size === 1) {
            const attachement = oldMessage.attachments.values().next().value.attachment;
            embed = new EmbedBuilder().setAuthor({
                name: oldMessage.author.username,
                iconURL: oldMessage.author.displayAvatarURL(),
            }).setDescription(newMessage.content).setImage(attachement.image);
        } else {
            embed = new EmbedBuilder().setAuthor({
                name: oldMessage.author.username,
                iconURL: oldMessage.author.displayAvatarURL(),
            }).setDescription(newMessage.content);
        }
        for (let dPMsg of DPMsgs) {
            let msg = await client.channels.fetch(dPMsg.id_channel);
            msg = await msg.messages.fetch(dPMsg.id_msg);
            try {
                await msg.edit({embeds: [embed]});
            } catch (err) {
                await sendLog(client, "Error while edit : " + err.message);
            }
        }
    }
});

client.on("ready", async () => {
    const bdd = await getBddInstance();
    for (const guild of client.guilds.cache.values()) {
        await updateCommands(client, guild.id);
    }
    await sendLog(client, 'Bot just started! (If it\'s not a restart it\'s a crash)');
});

client.on("guildCreate", async guild => {
    await updateCommands(client, guild.id);
    await sendLog(client,'Bot has join : ' + guild.name);
});

client.on("guildDelete", async guild => {
    await _resetServer(client, guild.id);
    await sendLog(client,'Bot has leave : ' + guild.name);
})

client.on("channelDelete", async channel => {
    await _resetChannel(client, channel.id);
})

client.login(process.env.TOKEN);