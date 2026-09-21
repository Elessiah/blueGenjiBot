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
import { installProcessGuards, reportError } from "./safe/processGuards.js";
import { safeReact } from "./safe/safeReact.js";
import { safeReply } from "./safe/safeReply.js";
import { updateCommands } from "./utils/updateCommands.js";
import { startInternalApi } from "@/internalApi.js";
import { purgeFeedIdentifiers } from "@/feed/feedBus.js";
import { recordDailySnapshot } from "@/snapshots/dailySnapshot.js";
import { sendDatabaseBackup } from "@/backup/weeklyBackup.js";

/**
 * Point d'entree du bot : client Discord, listeners d'evenements et taches cron.
 *
 * Tout vit ici plutot que d'etre eclate car c'est le seul endroit qui a besoin
 * de connaitre le client Discord ET l'API interne ET les crons a la fois — le
 * separer forcerait a faire circuler le `Client` un peu partout pour un gain
 * de lisibilite douteux. Chaque listener (`interactionCreate`, `messageCreate`,
 * ...) et chaque callback `cron.schedule` a sa propre garde try/catch : ils
 * s'executent hors de la pile applicative normale, et une exception non
 * capturee y devient un `unhandledRejection` qui tue le process (voir
 * `installProcessGuards`, `safe/processGuards.ts`).
 */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

installProcessGuards(client);

let internalApiServer: ReturnType<typeof startInternalApi> | null = null;

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isCommand()) return;

  // La garde couvre tout le corps, pas seulement le handler : `checkBan` et
  // `fillBlueCommands` touchent SQLite et peuvent lever (base verrouillée
  // pendant la sauvegarde, par exemple).
  const { commandName } = interaction;
  try {
    const banVerdict = await checkBan(client, interaction.user.id, false);
    if (banVerdict === "BANNED") {
      await safeReply(
        interaction as ChatInputCommandInteraction,
        "Banned members cannot use commands ! Contact `elessiah` for any moderation problem !",
      );
      return;
    }
    // Verdict indisponible : on n'execute pas la commande, mais on ne l'annonce
    // pas comme un bannissement -- ce serait accuser a tort tout le monde
    // pendant la sauvegarde nocturne. La commande aurait de toute facon echoue :
    // elle lit la meme base.
    if (banVerdict === "UNKNOWN") {
      await safeReply(
        interaction as ChatInputCommandInteraction,
        "Service temporarily unavailable, please try again in a moment.",
      );
      return;
    }

    let command = commands[commandName];
    if (!command) {
      command = (await fillBlueCommands(client))[commandName];
      if (!command) {
        await safeReply(interaction as ChatInputCommandInteraction, "Command not found");
        return;
      }
    }

    await command.handler(client, interaction, interaction.guildId);
  } catch (error) {
    await reportError(client, `commande /${commandName}`, error);
  }
});

client.on("messageCreate", async (message) => {
  try {
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
  } catch (error) {
    await reportError(client, "messageCreate", error);
  }
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
  try {
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

    // Le message d'origine peut avoir été supprimé entre l'édition et ici.
    await safeReact(client, newMessage, "📝");
  } catch (error) {
    await reportError(client, "messageUpdate", error);
  }
});

client.on("messageDelete", async (message) => {
  try {
    await deleteDPMsgs(client, message.id);
  } catch (error) {
    await reportError(client, "messageDelete", error);
  }
});

client.on("clientReady", async () => {
  try {
    // Avant d'ouvrir l'API interne, et non apres : c'est elle qui sert le flux
    // d'activite a l'app web, laquelle le republie sur une page publique. Une
    // base en service porte encore les identifiants Discord collectes avant la
    // regle d'anonymisation, et `getBacklog()` les rejouerait au premier
    // lecteur. La purge n'echoue jamais bruyamment : le bot doit demarrer meme
    // si elle ne passe pas.
    await purgeFeedIdentifiers(client);

    if (!internalApiServer) {
      internalApiServer = startInternalApi(client);
    }

    for (const guild of client.guilds.cache.values()) {
      console.log("Server ready : ", guild.name);
      await updateCommands(client, guild.id);
    }

    await checkIntervalleAdhesion(client);
    await recordDailySnapshot(client);
    // Une tâche cron s'exécute hors de toute pile applicative : sans garde, son
    // échec devient un rejet non capturé, donc un arrêt du process.
    cron.schedule(
      "5 0 * * *",
      async () => {
        try {
          await recordDailySnapshot(client);
        } catch (error) {
          await reportError(client, "cron recordDailySnapshot", error);
        }
      },
      { timezone: "Europe/Paris" },
    );
    cron.schedule(
      "0 10 * * *",
      async () => {
        try {
          await checkIntervalleAdhesion(client);
        } catch (error) {
          await reportError(client, "cron checkIntervalleAdhesion", error);
        }
      },
      { timezone: "Europe/Paris" },
    );
    // Sauvegarde hebdomadaire de la base envoyée en MP au propriétaire (lundi 04h00).
    cron.schedule(
      "0 4 * * 1",
      async () => {
        try {
          await sendDatabaseBackup(client);
        } catch (error) {
          await reportError(client, "cron sendDatabaseBackup", error);
        }
      },
      { timezone: "Europe/Paris" },
    );

    await sendLog(client, "Bot just started! (If it's not a restart it's a crash)");
  } catch (error) {
    await reportError(client, "clientReady", error);
  }
});

client.on("guildCreate", async (guild) => {
  try {
    for (const currentGuild of client.guilds.cache.values()) {
      await updateCommands(client, currentGuild.id);
    }
    const { runSetupWizard } = await import("@/utils/setupWizard.js");
    await runSetupWizard(guild, client);
    await sendLog(client, `Bot has join : ${guild.name}`);
  } catch (error) {
    await reportError(client, "guildCreate", error);
  }
});

client.on("guildDelete", async (guild) => {
  try {
    await _resetServer(client, guild.id);
    for (const currentGuild of client.guilds.cache.values()) {
      await updateCommands(client, currentGuild.id);
    }
    await sendLog(client, `Bot has leave : ${guild.name}`);
  } catch (error) {
    await reportError(client, "guildDelete", error);
  }
});

client.on("channelDelete", async (channel) => {
  try {
    await _resetChannel(client, channel.id);
  } catch (error) {
    await reportError(client, "channelDelete", error);
  }
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

// Contrairement aux erreurs de runtime, un échec de connexion laisse un process
// vivant mais inutile : on journalise puis on sort en erreur pour que pm2
// relance avec son backoff.
client.login(process.env.TOKEN).catch(async (error: unknown) => {
  await reportError(client, "login", error);
  process.exit(1);
});