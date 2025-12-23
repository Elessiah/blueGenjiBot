import type {Client, Message, OmitPartialGroupDMChannel} from "discord.js";

import {safeMsgReply} from "@/safe/safeMsgReply.js";

async function _deleteTempMsg(target: OmitPartialGroupDMChannel<Message> | null): Promise<void> {
    if (target) {
        await target.delete();
    }
}

async function answerTmp(client: Client,
                         message: Message,
                         content: string,
                         time: number) : Promise<void> {
    const temp_msg = await safeMsgReply(client, message, content);
    setTimeout(() => {
        void _deleteTempMsg(temp_msg);
    }, time);
}

export {answerTmp};