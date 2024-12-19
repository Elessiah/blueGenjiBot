const sendLog = require("./sendLog");

async function safeMsgReply(client, msg, content) {
    let nTry = 0;
    let err_msg = "";
    while (nTry < 10) {
        try {
            return await msg.reply(content);
        } catch (err) {
            err_msg = err.message;
            nTry += 1;
        }
    }
    await sendLog(client, "Error safeMsgReply : " + err_msg);
    return false;
}

module.exports = safeMsgReply;