import "dotenv/config";
import {
  Attachment,
  ChatInputCommandInteraction,
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
} from "discord.js";
import cron from "node-cron";
import { getBddInstance, closeBddInstance } from "./bdd/Bdd.js";
import { deleteDPMsgs } from "./bdd/deleteDPMsgs.js";
import { checkBan } from "./check/checkBan.js";
import { _resetChannel } from "./commandsHandlers/services/resetChannel.js";
import { _resetServer } from "./commandsHandlers/services/resetServer.js";
import { commands } from "./config/commands.js";
import { fillBlueCommands } from "./config/fillBlueCommands.js";
import { checkIntervalleAdhesion } from "@/adhesion/checkIntervalleAdhesion.js";
import { buildServiceMessage } from "./messages/buildServiceMessage.js";
import { manageDistribution } from "./messages/manageDistribution.js";
import { sendLog } from "./safe/sendLog.js";
import { safeReply } from "./safe/safeReply.js";
import { updateCommands } from "./utils/updateCommands.js";
import { startInternalApi } from "@/internalApi.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let internalApiServer: ReturnType<typeof startInternalApi> | null = null;

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  if (await checkBan(client, interaction.user.id, false)) {
    await safeReply(
      interaction as ChatInputCommandInteraction,
      "Banned members cannot use commands ! Contact `elessiah` for any moderation problem !",
    );
    return;
  }

  const { commandName } = interaction;
  let command = commands[commandName];
  if (!command) {
    command = (await fillBlueCommands(client))[commandName];
    if (!command) {
      await safeReply(interaction as ChatInputCommandInteraction, "Command not found");
      return;
    }
  }

  await command.handler(client, interaction, interaction.guildId);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.author.system) return;

  const bdd = await getBddInstance();
  let services: { name: string; id_service: number }[];

  try {
    services = (await bdd.get(
      "ChannelPartnerService",
      ["Service.name", "Service.id_service"],
      {
        Service: "ChannelPartnerService.id_service = Service.id_service",
        ChannelPartner: "ChannelPartnerService.id_channel = ChannelPartner.id_channel",
      },
      { query: "ChannelPartner.id_channel = ?", values: [message.channelId] },
    )) as { name: string; id_service: number }[];
  } catch (error) {
    await sendLog(client, `Error while getting services : ${(error as Error).message}`);
    return;
  }

  if (services.length > 0) {
    await manageDistribution(message, client, bdd, message.channelId, services);
  }
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  const bdd = await getBddInstance();
  const duplicatedMessages = (await bdd.get(
    "DPMsg",
    ["id_msg", "id_channel"],
    {},
    { query: "id_og = ?", values: [oldMessage.id] },
  )) as { id_msg: string; id_channel: string }[];

  if (!newMessage.guild || duplicatedMessages.length === 0) return;

  let embed;
  if (oldMessage.attachments.size === 1) {
    const attachment: Attachment | undefined = oldMessage.attachments.values().next().value;
    embed = await buildServiceMessage(client, newMessage, newMessage.channel.id, attachment);
  } else {
    embed = await buildServiceMessage(client, newMessage, newMessage.channel.id);
  }

  for (const duplicate of duplicatedMessages) {
    const channel = (await client.channels.fetch(duplicate.id_channel)) as TextChannel | null;
    if (!channel) {
      await sendLog(client, "Failed to retrieve message channel to update it !");
      continue;
    }

    let targetMessage: Message;
    try {
      targetMessage = (await channel.messages.fetch(duplicate.id_msg)) as Message;
    } catch (error) {
      await sendLog(client, `Failed to fetch duplicated message to update it ! ${(error as Error).message}`);
      continue;
    }

    try {
      await targetMessage.edit({ embeds: [embed] });
    } catch (error) {
      await sendLog(client, `Error while edit : ${(error as Error).message}`);
    }
  }

  await newMessage.react("📝");
});

client.on("messageDelete", async (message) => {
  await deleteDPMsgs(client, message.id);
});

client.on("clientReady", async () => {
  if (!internalApiServer) {
    internalApiServer = startInternalApi(client);
  }

  for (const guild of client.guilds.cache.values()) {
    console.log("Server ready : ", guild.name);
    await updateCommands(client, guild.id);
  }

  cron.schedule(
    "0 10 * * *",
    async () => {
      await checkIntervalleAdhesion(client);
    },
    { timezone: "Europe/Paris" },
  );

  await sendLog(client, "Bot just started! (If it's not a restart it's a crash)");
});

client.on("guildCreate", async (guild) => {
  for (const currentGuild of client.guilds.cache.values()) {
    await updateCommands(client, currentGuild.id);
  }
  await sendLog(client, `Bot has join : ${guild.name}`);
});

client.on("guildDelete", async (guild) => {
  await _resetServer(client, guild.id);
  for (const currentGuild of client.guilds.cache.values()) {
    await updateCommands(client, currentGuild.id);
  }
  await sendLog(client, `Bot has leave : ${guild.name}`);
});

client.on("channelDelete", async (channel) => {
  await _resetChannel(client, channel.id);
});

async function shutdown(): Promise<void> {
  console.log("Arrêt du bot...");

  await new Promise<void>((resolve) => {
    if (!internalApiServer) {
      resolve();
      return;
    }

    internalApiServer.close(() => resolve());
  });

  await client.destroy();
  closeBddInstance();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown();
});

process.on("SIGTERM", () => {
  void shutdown();
});

void client.login(process.env.TOKEN);
