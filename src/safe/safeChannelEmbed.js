const sendLog = require("./sendLog");

async function safeChannelEmbed(client, channel=null, embed=null, attachements=[]) {
    if (embed === null || channel === null || channel === undefined) {
        await sendLog(client, "Wrong parameter for safeChannelEmbed : \nChannel : " + channel + "\nEmbed : " + embed);
    }
    let nTry = 0;
    let err_msg = "";
    while (nTry < 10) {
        try {
            return await channel.send({embeds: [embed], files: attachements});
        } catch (err) {
            err_msg = err.message;
        }
        nTry++;
    }
    await sendLog(client, "SafeReply failed : " + err_msg);
    return false;
}

module.exports = safeChannelEmbed;