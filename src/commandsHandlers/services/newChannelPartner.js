const {ChatInputCommandInteraction, PermissionsBitField, EmbedBuilder} = require("discord.js");
const {getBddInstance} = require("../../bdd/Bdd");
const checkPermissions = require("../../check/checkPermissions");
const safeReply = require("../../safe/safeReply");
const safeChannelEmbed = require("../../safe/safeChannel");
const sendLog = require("../../safe/sendLog");
const {regions} = require("../../utils/globals");
const defineRankRange = require("../../utils/defineRankRange");
const setRankFilter = require("../../utils/setRankFilter");
const checkChannelMinPermissions = require("../../check/checkChannelMinPermissions");

/**
 * @param client
 * @param {ChatInputCommandInteraction<Cache>} interaction
 */
const newChannelPartner = async(client, interaction) => {
    try {
        if (!await checkPermissions(interaction)) {
            return await safeReply(interaction, "You don't have the permission to do this.", true);
        }
        const channel = interaction.options.getChannel("channel");
        if (!channel) {
            return await safeReply(interaction, "An error occured while trying to retrieve the channel targeted !");
        }
        const hasPerm = await checkChannelMinPermissions(client, channel);
        if (hasPerm === false) {
            return await safeReply(interaction, "An error occured, please try again !", true);
        } else if (hasPerm !== true) {
            return await safeReply(interaction, "Missing Permission: " + hasPerm, true);
        }
        const channel_id = channel.id;
        const service_name = interaction.options.getString("service");
        const region = interaction.options.getInteger("region-filter");
        const rank_range = await defineRankRange(interaction.options.getString("rank-min"), interaction.options.getString("rank-max"));

        const bdd = await getBddInstance();
        if (!bdd) {
            return await sendLog(client, "Bdd failed in NewChannelPartner!");
        }
        await interaction.deferReply({ephemeral: true});
        const result = await bdd.setNewPartnerChannel(channel_id, interaction.guild.id, service_name, region);
        if (result.success === true) {
            await setRankFilter(bdd, channel_id, rank_range);
            const channel = await interaction.guild.channels.cache.get(channel_id);
            await safeReply(interaction, `Service "${service_name}" added on "${channel.name}"`, true, true);
            const message = `This channel is now linked to the service \`${service_name.toUpperCase()}\` on region \`${regions[region]}\`.\nTo be shared, your message must contain the word \`${service_name.toUpperCase()}\``
            await sendLog(client, `${interaction.guild.name} has activated ${service_name} on region \`${regions[region]}\`!!`);
            const embed = new EmbedBuilder().setAuthor({name: "BlueGenjiBot"}).setDescription(message);
            await safeChannelEmbed(client, channel, embed);
        } else {
            await safeReply(interaction, result.message, true, true);
        }
    } catch (err) {
        await sendLog(client, err.message);
        await safeReply(interaction, "NewChannelPartner : " + err.message, true, true);
    }
}

module.exports = newChannelPartner;