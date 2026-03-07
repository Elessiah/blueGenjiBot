import 'dotenv/config';
import {
    Client,
    GatewayIntentBits,
    Attachment,
    ChatInputCommandInteraction,
    TextChannel, Message
} from "discord.js";
import {getBddInstance, closeBddInstance} from "./bdd/Bdd.js";
import {updateCommands} from "./utils/updateCommands.js";
import {commands} from "./config/commands.js";
import {manageDistribution} from "./messages/manageDistribution.js";
import {_resetServer} from "./commandsHandlers/services/resetServer.js";
import {sendLog} from "./safe/sendLog.js";
import {safeReply} from "./safe/safeReply.js";
import {_resetChannel} from "./commandsHandlers/services/resetChannel.js";
import {fillBlueCommands} from "./config/fillBlueCommands.js";
import {getInviteFromMessage} from "./utils/getInviteFromMessage.js";
import {deleteDPMsgs} from "./bdd/deleteDPMsgs.js";
import {checkBan} from "./check/checkBan.js";
import {buildServiceMessage} from "./messages/buildServiceMessage.js";
import cron from "node-cron";
import {checkIntervalleAdhesion} from "@/adhesion/checkIntervalleAdhesion.js";

const client = new Client({
            intents: [
                GatewayIntentBits.Guilds, // Nécessaire pour recevoir les événements des serveurs (guilds)
                GatewayIntentBits.GuildMembers,
                GatewayIntentBits.GuildMessages, // Pour les messages
                GatewayIntentBits.MessageContent  // Pour accéder au contenu des messages
            ],
        });

client.on("interactionCreate", async interaction => {
    if (!interaction.isCommand() || !interaction)
        return;
    if ((await checkBan(client, interaction.user.id, false))) {
        await safeReply(interaction as ChatInputCommandInteraction, "Banned members cannot use commands ! Contact `elessiah` for any moderation problem !");
        return;
    }
    const { commandName } = interaction;
    let command = commands[commandName];
    if (!command) {
        command = (await fillBlueCommands(client))[commandName];
        if (!command) {
            return await safeReply(interaction as ChatInputCommandInteraction, "Command not found");
        }
    }
    await command.handler(client, interaction, interaction.guildId);
});

client.on("messageCreate", async message => {
    if (message.author.bot || message.author.system) return;
    const { channelId } = message;
    const bdd = await getBddInstance();
    let services: {name: string; id_service: number}[];
    try {
        services = await bdd.get("ChannelPartnerService",
            ["Service.name", "Service.id_service"],
            {
                "Service": "ChannelPartnerService.id_service = Service.id_service",
                "ChannelPartner": "ChannelPartnerService.id_channel = ChannelPartner.id_channel"
            },
            {query: "ChannelPartner.id_channel = ?", values: [channelId]}
        ) as {name: string; id_service: number}[];
    } catch (e) {
        await sendLog(client, "Error while getting services : " + (e as TypeError).message);
        return;
    }
    if (services.length > 0) {
        await manageDistribution(message, client, bdd, channelId, services);
    }
})

client.on("messageUpdate", async (oldMessage, newMessage) => {
    const bdd = await getBddInstance();
    let DPMsgs: {id_msg: string, id_channel: string}[] = await bdd.get("DPMsg", ["id_msg", "id_channel"], {}, {query: "id_og = ?", values: [oldMessage.id]}) as {id_msg: string, id_channel: string}[];
    if (!newMessage.guild) return;
    const origin = "*Sent from : [" + newMessage.guild.name + "](" + await getInviteFromMessage(client, newMessage) + ")*";
    if (DPMsgs.length > 0) {
        let embed;
        if (oldMessage.attachments.size === 1) {
            const attachement: Attachment | undefined = oldMessage.attachments.values().next().value;
            embed = await buildServiceMessage(client, newMessage, newMessage.channel.id, attachement);
        } else {
            embed = await buildServiceMessage(client, newMessage, newMessage.channel.id);
        }
        for (let dPMsg of DPMsgs) {
            const channel: TextChannel | null = await client.channels.fetch(dPMsg.id_channel) as TextChannel | null;
            if (!channel) {
                await sendLog(client, "Failed to retrieve message channel to update it !");
                continue;
            }
            let msg: Message;
            try {
                msg = await channel.messages.fetch(dPMsg.id_msg) as Message;
            } catch (e) {
                await sendLog(client, "Failed to fetch duplicated message to update it ! " + (e as TypeError).message);
                continue;
            }
            try {
                await msg.edit({embeds: [embed]});
            } catch (err) {
                await sendLog(client, "Error while edit : " + (err as TypeError).message);
            }
        }
        await newMessage.react("📝");
    }
});

client.on("messageDelete", async (message) => {
    await deleteDPMsgs(client, message.id);
})

client.on("clientReady", async () => {
    for (const guild of client.guilds.cache.values()) {
        console.log("Server ready : ", guild.name);
        await updateCommands(client, guild.id);
    }
    cron.schedule(
        "0 10 * * *",
        /**
         * Callback quotidien qui déclenche l'envoi automatique des adhésions.
         */

        async () => {
            await checkIntervalleAdhesion(client);
        },
        { timezone: "Europe/Paris" }
    );
    await sendLog(client, 'Bot just started! (If it\'s not a restart it\'s a crash)');
});

client.on("guildCreate", async guild => {
    for (const guild of client.guilds.cache.values()) {
        await updateCommands(client, guild.id);
    }
    await sendLog(client,'Bot has join : ' + guild.name);
});

client.on("guildDelete", async guild => {
    await _resetServer(client, guild.id);
    for (const guild of client.guilds.cache.values()) {
        await updateCommands(client, guild.id);
    }
    await sendLog(client,'Bot has leave : ' + guild.name);
})

client.on("channelDelete", async channel => {
    await _resetChannel(client, channel.id);
})

process.on('SIGINT', async () => {
    console.log('Arrêt du bot...');
    await client.destroy();
    closeBddInstance();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Arrêt du bot...');
    await client.destroy();
    await closeBddInstance();
    process.exit(0);
});

client.login(process.env.TOKEN);
