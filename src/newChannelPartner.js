const {ChatInputCommandInteraction} = require("discord.js");
const {getBddInstance} = require("./Bdd");

/**
 * @param {ChatInputCommandInteraction<Cache>} interaction
 */
const newChannelPartner = async(interaction) => {
    const channel_id = interaction.options.getChannel("channel").id;
    const service_name = interaction.options.getString("service");

    if (!interaction.member.permissions.has("ADMINISTRATOR")) {
        interaction.reply({ content: "You don't have the permission to do this.", ephemeral: true });
        return;
    }
    console.log("Before");
    const bdd = await getBddInstance();
    if (!bdd) {
        console.log("Bdd failed !")
        return;
    }
    console.log("After");
    const result = await bdd.setNewPartnerChannel(channel_id, service_name);
    if (result.success) {
        interaction.reply({ content: `Service ${service_name} added on ${channel_id}`, ephemeral: true });
    } else {
        interaction.reply({ content: result.message, ephemeral: true });
    }
}

module.exports = newChannelPartner;