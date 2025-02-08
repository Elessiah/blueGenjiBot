const {getBddInstance} = require("./Bdd");
const sendLog = require("./safe/sendLog");

async function manageMsgExpiration(client) {
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Failed get bdd instance in manageMsgExpiration");
        return;
    }
    const expiration = new Date(await bdd.getCurrentTimestamp());
    expiration.setHours(expiration.getHours() - 72);
    await bdd.rm('DPMsg', {}, {}, {}, {"date": expiration.toISOString()});
    const expiredMsgs = await bdd.get("OGMsg", ["id_msg"], {}, {}, null, "", {}, {"date": expiration.toISOString()});
    for (const expiredMsg of expiredMsgs) {
        await bdd.rm('MessageService', {}, {"id_msg": expiredMsg.id_msg});
    }
    await bdd.rm('OGMsg', {}, {}, {}, {"OGMsg.date": expiration.toISOString()});
}

module.exports = manageMsgExpiration;