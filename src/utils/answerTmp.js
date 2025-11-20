const safeMsgReply = require("../safe/safeMsgReply");

async function answerTmp(client, message, content, time) {
    const temp_msg = await safeMsgReply(client, message, content);
    if (temp_msg == null)
        return;
    setTimeout(async() => {
        if (temp_msg != null)
            await temp_msg.delete();
    }, time);
}

module.exports = answerTmp;