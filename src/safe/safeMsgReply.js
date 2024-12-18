const sendLog = require("./sendLog");

async function safeMsgReply(client, msg, content) {
    let nTry = 0;
    let success = false;
    let err_msg = "";
    while (nTry < 10 && success === false) {
        try {
            await msg.reply(content);
            success = true;
        } catch (err) {
            err_msg = err.message;
            nTry += 1;
        }
    }
    if (success) {
        return true;
    }
    await sendLog(client, "Error safeMsgReply : " + err_msg);
    return false;
}

module.exports = safeMsgReply;