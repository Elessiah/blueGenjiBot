const {getBddInstance} = require("../bdd/Bdd");
const sendLog = require("../safe/sendLog");

async function checkCooldown(author, service) {
    if (author === process.env.OWNER_ID)
        return true;
    const bdd = await getBddInstance();
    let dates;
    try {
        dates = await bdd.get("OGMsg",
            ['date'],
            {'MessageService': 'OGMsg.id_msg = MessageService.id_msg'},
            {id_author: author, id_service: service},
            false,
            'date');
    } catch (e) {
        return false;
    }
    if (dates.length < 1) {
        return true;
    }
    const delay = 120 - ((new Date(await bdd.getCurrentTimestamp()) - new Date(dates[0].date)) / (1000 * 60));
    if (delay > 0)
        return delay.toFixed(1);
    return true;
}

module.exports = { checkCooldown };