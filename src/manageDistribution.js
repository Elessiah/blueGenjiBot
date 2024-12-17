const {EmbedBuilder} = require("discord.js");
const safeChannelEmbed = require("./safe/safeChannelEmbed");
const sendLog = require("./safe/sendLog");

async function manageDistribution(message, client, bdd, channelId, services) {
    try {
        let has_send = false;
        for (const service of services) {
            if (message.content.toLowerCase().includes(service.name)) {
                has_send = true;
                const targets = await bdd.get("ChannelPartnerService",
                    ["id_channel"],
                    {Service: "ChannelPartnerService.id_service = Service.id_service"},
                    {"Service.name": service.name});
                for (const target of targets) {
                    if (target.id_channel === channelId) {
                        continue;
                    }
                    const channel = await client.channels.fetch(target.id_channel);
                    const embed = new EmbedBuilder().setAuthor({
                        name: message.author.username,
                        iconURL: message.author.displayAvatarURL(),
                    }).setDescription(message.content);
                    await safeChannelEmbed(client, channel, embed)
                }
            }
        }
        if (has_send) {
            await message.react("🛰️");
        }
    } catch (err) {
        await sendLog(client, "manageDistribution error : \n" + err);
    }
}

module.exports = manageDistribution;