import { getBddInstance } from "../bdd/Bdd.js";
async function checkCooldown(author, service) {
    if (author === process.env.OWNER_ID) {
        return "";
    }
    const bdd = await getBddInstance();
    const dates = await bdd.get("OGMsg", ['date'], { 'MessageService': 'OGMsg.id_msg = MessageService.id_msg' }, { query: "id_author = ? AND id_service = ?", values: [author, service] }, false, 'date');
    if (dates.length < 1) {
        return "";
    }
    const currentDate = new Date(await bdd.getCurrentTimestamp());
    const lastMsgDate = new Date(dates[0].date);
    const delayLastMsg = currentDate.getTime() - lastMsgDate.getTime();
    const delayLastMsgMin = delayLastMsg / (1000 * 60);
    const delay = 120 - delayLastMsgMin;
    if (delay > 0) {
        return delay.toFixed(1);
    }
    return "";
}
export { checkCooldown };
//# sourceMappingURL=checkCooldown.js.map