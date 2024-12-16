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
    let err_msg = "";
    let success = false;
    let nTry = 0;
    while (nTry < 10 && success === false) {
        try {
            const ret = await bdd.deleteChannelServices(channel_id);
            if (ret.success) {
                await interaction.reply({content: `Channel "${interaction.channel.name}" reseted`, ephemeral: true})
            } else {
                await interaction.reply({content: ret.message, ephemeral: true})
            }
            success = true;
        } catch (err) {
            err_msg = err.message;
            nTry++;
        }
    }
    if (nTry === 10) {
        await interaction.reply({content: err_msg + "\n Please contact elessiah", ephemeral: true});
        const owner = await interaction.client.users.fetch(process.env.OWNER_ID);
        await owner.send("resetChannel Interaction reply: \n" + err_msg);
    }
}

module.exports = resetChannel;