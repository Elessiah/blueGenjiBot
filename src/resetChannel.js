const {getBddInstance} = require("./Bdd");
const checkPermissions = require("./checkPermissions");

const resetChannel = async(interaction) => {
    if (!await checkPermissions(interaction)) {
        await interaction.reply({ content: "You don't have the permission to do this.", ephemeral: true });
        return;
    }
    const channel_id = await interaction.options.getChannel("channel").id;

    const bdd = await getBddInstance();
    if (!bdd) {
        console.log("Bdd failed !");
        await interaction.reply({content: "Bdd failed !", ephemeral: true});
        return;
    }
    try {
        const ret = await bdd.deleteChannelServices(channel_id);
        if (ret.success) {
            await interaction.reply({content: `Channel "${interaction.channel.name}" reseted`, ephemeral: true})
        } else {
            await interaction.reply({content: ret.message, ephemeral: true})
        }
    } catch (err) {
        await interaction.reply({content: err.message + "\n Please contact elessiah", ephemeral: true});
    }
}

module.exports = resetChannel;