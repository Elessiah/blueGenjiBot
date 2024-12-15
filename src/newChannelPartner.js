const {ChatInputCommandInteraction, PermissionsBitField, EmbedBuilder} = require("discord.js");
const {getBddInstance} = require("./Bdd");
const checkPermissions = require("./checkPermissions");

/**
 * @param {ChatInputCommandInteraction<Cache>} interaction
 */
const newChannelPartner = async(interaction) => {
    if (!await checkPermissions(interaction)) {
        interaction.reply({ content: "You don't have the permission to do this.", ephemeral: true });
        return;
    }
    const channel_id = interaction.options.getChannel("channel").id;
    const service_name = interaction.options.getString("service");

    const bdd = await getBddInstance();
    if (!bdd) {
        console.log("Bdd failed !")
        return;
    }
    try {
        const result = await bdd.setNewPartnerChannel(channel_id, interaction.guild.id, service_name);
        if (result.success) {
            const channel = interaction.guild.channels.cache.get(channel_id);
            await interaction.reply({content: `Service "${service_name}" added on "${channel.name}"`, ephemeral: true});
            const message = `This channel is now linked to the service \`${service_name.toUpperCase()}\`\nTo be shared, your message must contain the word \`${service_name.toUpperCase()}\``
            const embed = new EmbedBuilder().setAuthor({name: "BlueGenjiBot"}).setDescription(message);
            channel.send({embeds: [embed]});
        } else {
            await interaction.reply({content: result.message, ephemeral: true});
        }
    } catch (err) {
        console.log(err);
        const owner = await interaction.client.users.fetch(process.env.OWNER_ID);
        await owner.send("NewChannelParner: \n" + err);
        await interaction.reply({content: err.message + "\n Please contact elessiah", ephemeral: true});
    }
}

module.exports = newChannelPartner;