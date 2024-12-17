const {getBddInstance} = require("./Bdd");
const sendLog = require("./safe/sendLog");
const safeReply = require("./safe/safeReply");

const listPartner = async(interaction) => {
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog("Bdd failed in ListPartner!");
        return;
    }
    const service_name = interaction.options.getString("service");
    const channels_id = await bdd.get("ChannelPartnerService",
        ["id_channel"],
        {"Service": "ChannelPartnerService.id_service = Service.id_service"},
        {name: service_name}
    );
    let guilds = [];
    const client = interaction.client;
    for (const channel_id of channels_id) {
        try {
            const channel = await client.channels.fetch(channel_id.id_channel);
            guilds.push(" - " + channel.guild.name);
        } catch (error) {
            console.log(error);
        }
    }
    const content = `List of all affiliated servers for service ${service_name} : \n` + guilds.join("\n");
    await safeReply(interaction, content, true);
}

module.exports = { listPartner };