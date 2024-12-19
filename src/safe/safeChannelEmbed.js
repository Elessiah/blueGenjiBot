const sendLog = require("./sendLog");

async function safeChannelEmbed(client, channel=null, embed=null, attachements=[]) {
    if (embed === null || channel === null || channel === undefined) {
        await sendLog(client, "Wrong parameter for safeChannelEmbed : \nChannel : " + channel + "\nEmbed : " + embed);
    }
    let nTry = 0;
    let success = false;
    let err_msg = "";
    while (nTry < 10 && success === false) {
        try {
            await channel.send({embeds: [embed], files: attachements});
            success = true;
        } catch (err) {
            err_msg = err.message;
        }
        nTry++;
    }
    if (nTry === 10) {
        await sendLog(client, "SafeReply failed : " + err_msg);
        return false;
    }
    return true;
}

module.exports = safeChannelEmbed;