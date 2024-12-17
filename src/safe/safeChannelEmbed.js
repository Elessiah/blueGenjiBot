const sendLog = require("./sendLog");

async function safeChannelEmbed(client, channel=null, embed=null) {
    let nTry = 0;
    let success = false;
    let err_msg = "";
    while (nTry < 10 && success === false) {
        try {
            await channel.send({embeds: [embed]});
            success = true;
        } catch (err) {
            err_msg = err.message;
        }
        nTry++;
    }
    if (nTry === 10) {
        await sendLog("SafeReply failed : " + err_msg);
        return false;
    }
}

module.exports = safeChannelEmbed;