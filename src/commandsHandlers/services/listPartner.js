const {getBddInstance} = require("../../bdd/Bdd");
const sendLog = require("../../safe/sendLog");
const safeReply = require("../../safe/safeReply");
const {regions} = require("../../utils/enums");
const getInviteFromChannel = require("../../utils/getInviteFromChannel");
const safeChannel = require("../../safe/safeChannel");

const listPartner = async(client, interaction) => {
    try {
        const bdd = await getBddInstance();
        if (!bdd) {
            await sendLog(client, "Bdd failed in ListPartner!");
            return;
        }
        const service_name = interaction.options.getString("service");
        const channels = await bdd.get("ChannelPartnerService",
            ["ChannelPartnerService.id_channel", "region"],
            {
                "Service": "ChannelPartnerService.id_service = Service.id_service",
                "ChannelPartner": "ChannelPartnerService.id_channel = ChannelPartner.id_channel",
            },
            {name: service_name}
        );
        let guilds = [[], [], [], [], []];
        for (const channel_info of channels) {
            const channel = await client.channels.fetch(channel_info.id_channel);
                guilds[channel_info.region].push(" - [" + channel.guild.name + "](" + (await getInviteFromChannel(channel)) + ")");
        }
        let subContent = "";
        for (let i = 0; i < regions.length; i++) {
            if (guilds[i].length > 0)
                subContent += `## ${regions[i]}\n` + guilds[i].join("\n") + '\n';
        }
        const content = `List of all affiliated servers for service ${service_name} *(Invite link embedded in a hyperlink with their name)* : \n` + subContent + '----------\nThanks again for using our services !';
        console.log("Interaction :  ", interaction);
        if (await safeReply(interaction, content, true) === false) {
            await safeChannel(client, interaction.channel, null, [], content);
        }
    } catch (e) {
        await safeReply(interaction, "An error occurred while trying to retrieve list. Please try again.");
        console.log("Error while displaying listPartner : ", e.message);
    }
}

module.exports = { listPartner };