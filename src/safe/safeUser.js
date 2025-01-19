const sendLog = require("./sendLog");

async function safeUser(client, user=null, embed=null, attachements=[], content="") {
    if ((embed === null && content === "") || user === null || user === undefined) {
        await sendLog(client, "Wrong parameter for safeChannel : \nUser : " + user + "\nEmbed : " + embed);
    }
    let nTry = 0;
    let err_msg = "";
    while (nTry < 10) {
        try {
            if (embed !== null) {
                return await user.send({content: content, embeds: [embed], files: attachements});
            } else {
                return await user.send({content: content, files: attachements});
            }
        } catch (err) {
            err_msg = err.message;
        }
        nTry++;
    }
    await sendLog(client, "SafeUser failed : " + err_msg);
    return false;
}

module.exports = safeUser;