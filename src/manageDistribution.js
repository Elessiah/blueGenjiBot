const {EmbedBuilder, AttachmentBuilder} = require("discord.js");
const safeChannelEmbed = require("./safe/safeChannelEmbed");
const sendLog = require("./safe/sendLog");
const safeMsgReply = require("./safe/safeMsgReply");

async function manageDistribution(message, client, bdd, channelId, services) {
    try {
        let has_send = false;
        let attachement = "";
        if (message.attachments.size === 1) {
            attachement =message.attachments.values().next().value.attachment;
        }
        else if (message.attachments.size > 1) {
            await safeMsgReply(client, message, "You cannot send more than one attachment ! Cancel your Distribution.");
            return false;
        }
        for (const service of services) {
            if (message.content.toLowerCase().includes(service.name + " ")) {
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
                    let embed;
                    if (attachement.length > 0) {
                        embed = new EmbedBuilder().setAuthor({
                            name: message.author.username,
                            iconURL: message.author.displayAvatarURL(),
                        }).setDescription(message.content).setImage(attachement);
                    } else {
                        embed = new EmbedBuilder().setAuthor({
                            name: message.author.username,
                            iconURL: message.author.displayAvatarURL(),
                        }).setDescription(message.content);
                    }
                    await safeChannelEmbed(client, channel, embed);
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