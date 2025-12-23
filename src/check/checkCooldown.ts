import {getBddInstance} from "../bdd/Bdd.js";

async function checkCooldown(author: string,
                             service: number): Promise<string> {
    if (author === process.env.OWNER_ID)
        {return "";}
    const bdd = await getBddInstance();
    const dates: {date: Date}[] = (await bdd.get("OGMsg",
        ['date'],
        {'MessageService': 'OGMsg.id_msg = MessageService.id_msg'},
        {query: "id_author = ? AND id_service = ?", values: [author, service]},
        false,
        'date') as {date: Date}[]);
    if (dates.length < 1) {
        return "";
    }
    const currentDate : Date = new Date(await bdd.getCurrentTimestamp());
    const lastMsgDate : Date = new Date(dates[0].date);

    const delayLastMsg: number = currentDate.getTime() - lastMsgDate.getTime();
    const delayLastMsgMin: number = delayLastMsg / (1000 * 60);

    const delay = 120 - delayLastMsgMin;
    if (delay > 0)
        {return delay.toFixed(1);}
    return "";
}

export { checkCooldown };