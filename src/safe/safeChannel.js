const sendLog = require("./sendLog");

async function safeChannel(client, channel=null, embed=null, attachements=[], content="") {
    if ((embed === null && content === "") || channel === null || channel === undefined) {
        await sendLog(client, "Wrong parameter for safeChannel : \nChannel : " + channel + "\nEmbed : " + embed);
    }
    let nTry = 0;
    let err_msg = "";
    while (nTry < 3) {
        try {
            if (embed !== null) {
                return await channel.send({content: content, embeds: [embed], files: attachements});
            } else {
                return await channel.send({content: content, files: attachements});
            }
        } catch (err) {
            err_msg = err.message;
        }
        nTry++;
    }
    await sendLog(client, "SafeMessage failed  to `" + channel.guild.name + "` : " + err_msg);
    return false;
}

module.exports = safeChannel;