const {EmbedBuilder} = require("discord.js");
const safeChannelEmbed = require("./safe/safeChannelEmbed");
const sendLog = require("./safe/sendLog");
const safeMsgReply = require("./safe/safeMsgReply");
const delay = require("./delay");
const {getBddInstance} = require("./Bdd");
const {searchString} = require("./searchString");

async function manageDistribution(message, client, bdd, channelId, services) {
    try {
        let attachement = "";
        if (message.attachments.size === 1) {
            attachement = message.attachments.values().next().value.attachment;
        }
        else if (message.attachments.size > 1) {
            await safeMsgReply(client, message, "You cannot send more than one attachment ! Cancel your Distribution.");
            return false;
        }
        let nbPartner = 0;
        for (const service of services) {
            if (await searchString(service.name.toLowerCase(), message.content.toLowerCase()) === true) {
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
                    const sentMsg = await safeChannelEmbed(client, channel, embed);
                    if (sentMsg !== false) {
                        const ret = await bdd.set("DPMsg",
                            ['id_msg', 'id_channel', 'id_og'],
                            [sentMsg.id, channel.id, message.id]);
                        if (ret.success === false) {
                            await sendLog(client, "In manageDistribution : " + ret.message);
                        }
                        nbPartner++;
                    }
                }
            }
        }
        if (nbPartner > 0) {
            const ret = await bdd.set("OGMsg", ['id_msg', 'id_author'], [message.id, message.author.id]);
            if (ret.success === false) {
                await sendLog(client, "In manageDistribution: " + ret.message);
            }
            await message.react("🛰️");
            const temp_msg = await safeMsgReply(client, message, "Your message has been sent to " + nbPartner + " channels !");
            await delay(30000);
            await temp_msg.delete();
        }
    } catch (err) {
        console.error(err);
        await sendLog(client, "manageDistribution error : \n" + err.message);
    }
}

module.exports = manageDistribution;