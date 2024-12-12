import "dotenv/config";
import { EmbedBuilder, REST, TextChannel } from "discord.js";
import { Client, GatewayIntentBits, ChannelType } from "discord.js";

const { TOKEN, DEEPL_TOKEN } = process.env;

export const translator = new deepl.Translator(DEEPL_TOKEN as string);
const combinedRegex =
  /(?:https?:\/\/|www\.)[^\s]+|<@[^>]+>|\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi;

//const regex = new RegExp(regexp);

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

(async () => {
  await connect();
})();

client.on("interactionCreate", async (interaction) => {
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "select-tunnel") {
      const selectedValue = interaction.values[0];
      await Tunnel.deleteOne({ _id: selectedValue });
      interaction.reply({ content: "Tunnel deleted !", ephemeral: true });
      return;
    }
  }
  if (!interaction.isCommand() || !interaction) return;
  const { commandName } = interaction;
  const command = commands[commandName];
  if (!command) {
    interaction.reply({ content: "Unknown command !", ephemeral: true });
    return;
  }
  command.handler(interaction, interaction.guildId);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot || message.author.system) return;
  const { channelId } = message;
  const tunnels = (await Tunnel.find({
    srcChannelId: channelId,
  })) as TunnelType[];
  if (!tunnels) return;
  tunnels.forEach(async (tunnel) => {
    const destChannel = client.channels.cache.get(
      tunnel.destChannelId
    ) as TextChannel;
    if (!destChannel) return;

    let splitParts = message.content.split(combinedRegex);

    for (let i = 0; i < splitParts.length; i++) {
      const part = splitParts[i].trim();
      if (part === "") continue;

      const trad = await translator.translateText(
        part,
        tunnel.srcLanguage as deepl.SourceLanguageCode,
        tunnel.destLanguage as deepl.TargetLanguageCode
      );
      splitParts[i] = trad.text;
    }

    let urls = message.content.match(combinedRegex) || [];
    let processMessage = [];
    for (let i = 0; i < splitParts.length; i++) {
      processMessage.push(splitParts[i]);
      if (urls[i]) {
        processMessage.push(urls[i]);
      }
    }

    const embed = new EmbedBuilder()
      .setAuthor({
        name: message.author.username,
        iconURL: message.author.displayAvatarURL(),
      })
      .setDescription(`**${processMessage.join(" ")}**`);

    destChannel.send({ embeds: [embed] });
  });
});

client.on("ready", () => {
  client.guilds.cache.forEach((guild) => {
    putCommands(guild.id);
    console.log(`bot is ready on ${guild.name}`);
  });
});

client.login(TOKEN);
