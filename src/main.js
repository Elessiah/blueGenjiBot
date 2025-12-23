require('dotenv').config();
import { Client, GatewayIntentBits } from "discord.js";
import { getBddInstance, closeBddInstance } from "./bdd/Bdd.ts";
import { updateCommands } from "./utils/updateCommands.ts";
import { commands } from "./config/commands.ts";
import { manageDistribution } from "./messages/manageDistribution.ts";
import { _resetServer } from "./commandsHandlers/services/resetServer.ts";
import { sendLog } from "./safe/sendLog.ts";
import { safeReply } from "./safe/safeReply.ts";
import { _resetChannel } from "./commandsHandlers/services/resetChannel.ts";
import { fillBlueCommands } from "./config/fillBlueCommands.ts";
import { getInviteFromMessage } from "./utils/getInviteFromMessage.ts";
import { deleteDPMsgs } from "./bdd/deleteDPMsgs.ts";
import { checkBan } from "./check/checkBan.ts";
import { buildServiceMessage } from "./messages/buildServiceMessage.ts";
let { messageCounter } = require("./utils/globals.ts");
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, // Nécessaire pour recevoir les événements des serveurs (guilds)
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages, // Pour les messages
        GatewayIntentBits.MessageContent // Pour accéder au contenu des messages
    ],
});
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isCommand() || !interaction)
        return;
    if ((await checkBan(client, interaction.user.id, false))) {
        await safeReply(interaction, "Banned members cannot use commands ! Contact `elessiah` for any moderation problem !");
        return;
    }
    const { commandName } = interaction;
    let command = commands[commandName];
    if (!command) {
        command = (await fillBlueCommands(client))[commandName];
        if (!command) {
            return await safeReply(interaction, "Command not found");
        }
    }
    await command.handler(client, interaction, interaction.guildId);
});
client.on("messageCreate", async (message) => {
    if (message.author.bot || message.author.system)
        return;
    const { channelId } = message;
    const bdd = await getBddInstance();
    let services;
    try {
        services = await bdd.get("ChannelPartnerService", ["Service.name", "Service.id_service"], {
            "Service": "ChannelPartnerService.id_service = Service.id_service",
            "ChannelPartner": "ChannelPartnerService.id_channel = ChannelPartner.id_channel"
        }, { query: "ChannelPartner.id_channel = ?", values: [channelId] });
    }
    catch (e) {
        await sendLog(client, "Error while getting services : " + e.message);
        return;
    }
    if (services.length > 0) {
        await manageDistribution(message, client, bdd, channelId, services);
    }
});
client.on("messageUpdate", async (oldMessage, newMessage) => {
    const bdd = await getBddInstance();
    let DPMsgs = await bdd.get("DPMsg", ["id_msg", "id_channel"], {}, { query: "id_og = ?", values: [oldMessage.id] });
    const origin = "*Sent from : [" + newMessage.guild.name + "](" + await getInviteFromMessage(client, newMessage) + ")*";
    if (DPMsgs.length > 0) {
        let embed;
        if (oldMessage.attachments.size === 1) {
            const attachement = oldMessage.attachments.values().next().value;
            embed = await buildServiceMessage(client, newMessage, newMessage.channel.id, attachement);
        }
        else {
            embed = await buildServiceMessage(client, newMessage, newMessage.channel.id, null);
        }
        for (let dPMsg of DPMsgs) {
            let msg = await client.channels.fetch(dPMsg.id_channel);
            msg = await msg.messages.fetch(dPMsg.id_msg);
            try {
                await msg.edit({ embeds: [embed] });
            }
            catch (err) {
                await sendLog(client, "Error while edit : " + err.message);
            }
        }
        await newMessage.react("📝");
    }
});
client.on("messageDelete", async (message) => {
    await deleteDPMsgs(client, message.id);
});
client.on("ready", async () => {
    for (const guild of client.guilds.cache.values()) {
        await updateCommands(client, guild.id);
    }
    messageCounter = 0;
    await sendLog(client, 'Bot just started! (If it\'s not a restart it\'s a crash)');
});
client.on("guildCreate", async (guild) => {
    for (const guild of client.guilds.cache.values()) {
        await updateCommands(client, guild.id);
    }
    await sendLog(client, 'Bot has join : ' + guild.name);
});
client.on("guildDelete", async (guild) => {
    await _resetServer(client, guild.id);
    for (const guild of client.guilds.cache.values()) {
        await updateCommands(client, guild.id);
    }
    await sendLog(client, 'Bot has leave : ' + guild.name);
});
client.on("channelDelete", async (channel) => {
    await _resetChannel(client, channel.id);
});
process.on('SIGINT', async () => {
    console.log('Arrêt du bot...');
    await client.destroy();
    await closeBddInstance();
    process.exit(0);
});
process.on('SIGTERM', async () => {
    console.log('Arrêt du bot...');
    await client.destroy();
    await closeBddInstance();
    process.exit(0);
});
client.login(process.env.TOKEN);
//# sourceMappingURL=main.js.map