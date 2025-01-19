const {ChatInputCommandInteraction, PermissionsBitField, EmbedBuilder} = require("discord.js");
const {getBddInstance} = require("./Bdd");
const checkPermissions = require("./checkPermissions");
const safeReply = require("./safe/safeReply");
const safeChannelEmbed = require("./safe/safeChannel");
const sendLog = require("./safe/sendLog");

/**
 * @param client
 * @param {ChatInputCommandInteraction<Cache>} interaction
 */
const newChannelPartner = async(client, interaction) => {
    if (!await checkPermissions(interaction)) {
        return await safeReply(interaction,"You don't have the permission to do this.", true);
    }
    const channel_id = interaction.options.getChannel("channel").id;
    const service_name = interaction.options.getString("service");

    const bdd = await getBddInstance();
    if (!bdd) {
        return await sendLog(client, "Bdd failed in NewChannelPartner!");
    }
    try {
        const result = await bdd.setNewPartnerChannel(channel_id, interaction.guild.id, service_name);
        if (result.success === true) {
            const channel = await interaction.guild.channels.cache.get(channel_id);
            await safeReply(interaction, `Service "${service_name}" added on "${channel.name}"`, true);
            const message = `This channel is now linked to the service \`${service_name.toUpperCase()}\`\nTo be shared, your message must contain the word \`${service_name.toUpperCase()}\``
            const embed = new EmbedBuilder().setAuthor({name: "BlueGenjiBot"}).setDescription(message);
            await safeChannelEmbed(client, channel, embed);
        } else {
            await safeReply(interaction, result.message, true);
        }
    } catch (err) {
        await sendLog(client, err.message);
        await safeReply(interaction, "NewChannelPartner : " + err.message, true);
    }
}

module.exports = newChannelPartner;