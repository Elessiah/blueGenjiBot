import { getBddInstance } from "../../bdd/Bdd.js";
import { checkPermissions } from "../../check/checkPermissions.js";
import { checkChannelMinPermissions } from "../../check/checkChannelMinPermissions.js";
import { safeReply } from "../../safe/safeReply.js";
import { safeChannel } from "../../safe/safeChannel.js";
import { sendLog } from "../../safe/sendLog.js";
import { regions } from "../../utils/globals.js";
import { defineRankRange } from "../../utils/defineRankRange.js";
import { setRankFilter } from "../../utils/setRankFilter.js";
import { MessageFlags } from "discord.js";
import { EmbedBuilder } from 'discord.js';
/**
 * @param client
 * @param {ChatInputCommandInteraction<Cache>} interaction
 */
async function newChannelPartner(client, interaction) {
    try {
        if (!await checkPermissions(interaction)) {
            await safeReply(interaction, "You don't have the permission to do this.", true);
            return false;
        }
        const channel = interaction.options.getChannel("channel");
        if (!channel) {
            await safeReply(interaction, "An error occured while trying to retrieve the channel targeted !");
            return false;
        }
        const hasPerm = await checkChannelMinPermissions(client, channel);
        if (hasPerm.length) {
            await safeReply(interaction, "Missing Permission: " + hasPerm, true);
            return false;
        }
        const channel_id = channel.id;
        const service_name = interaction.options.getString("service");
        if (!service_name) {
            await safeReply(interaction, "Missing service name !", true);
            return false;
        }
        const region = interaction.options.getInteger("region-filter");
        if (!region) {
            await safeReply(interaction, "Missing region filter !", true);
            return false;
        }
        const rank_min = interaction.options.getString("rank_min");
        const rank_max = interaction.options.getString("rank_max");
        if (rank_min == null || rank_max == null) {
            await safeReply(interaction, "Missing rank min and / or max", true);
            return false;
        }
        const rank_range = await defineRankRange(rank_min, rank_max);
        const bdd = await getBddInstance();
        if (!bdd) {
            await sendLog(client, "Bdd failed in NewChannelPartner!");
            return false;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        if (!interaction.guild) {
            await safeReply(interaction, "Interaction was broken, please try again.", true);
            return false;
        }
        const result = await bdd.setNewPartnerChannel(channel_id, interaction.guild.id, service_name, region);
        if (result.success) {
            await setRankFilter(bdd, channel_id, rank_range);
            const channel = interaction.guild.channels.cache.get(channel_id);
            if (!channel) {
                await safeReply(interaction, "Cannot retrieve the new partner to notify the link in it !");
                await sendLog(client, "Cannot retrieve the new partner channel to notify the link in it !");
                return false;
            }
            await safeReply(interaction, `Service "${service_name}" added on "${channel.name}"`, true, true);
            const message = `This channel is now linked to the service \`${service_name.toUpperCase()}\` on region \`${regions[region]}\`.\nTo be shared, your message must contain the word \`${service_name.toUpperCase()}\``;
            await sendLog(client, `${interaction.guild.name} has activated ${service_name} on region \`${regions[region]}\`!!`);
            const embed = new EmbedBuilder().setAuthor({ name: "BlueGenjiBot" }).setDescription(message);
            await safeChannel(client, channel, embed);
            return true;
        }
        else {
            await safeReply(interaction, result.message, true, true);
            return false;
        }
    }
    catch (err) {
        await sendLog(client, err.message);
        await safeReply(interaction, "NewChannelPartner : " + err.message, true, true);
        return false;
    }
}
export { newChannelPartner };
//# sourceMappingURL=newChannelPartner.js.map