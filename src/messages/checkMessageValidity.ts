import type {Client, Message} from "discord.js";

import type {Service} from "../bdd/types.js";
import {checkBan} from "../check/checkBan.js";
import {checkCooldown} from "../check/checkCooldown.js";
import {answerTmp} from "../utils/answerTmp.js";
import {searchString} from "../utils/searchString.js";

async function checkMessageValidity(client: Client,
                                    service: Service,
                                    messageContentLower: string,
                                    message: Message,
                                    hasValidService: {value: boolean}): Promise<boolean> {
    if (!await searchString(service.name, messageContentLower)) {
        return false;
    } else {
        hasValidService.value = true;
    }
    if (await checkBan(client, message.author.id)) {
        await message.react("🚫");
        return false;
    }
    const cooldown: string = await checkCooldown(message.author.id, service.id_service);
    if (cooldown.length > 0) {
        void answerTmp(client, message, `You must wait ${cooldown} minutes before sending again a message on this service`, 30000);
        return false;
    }
    return true;
}

export {checkMessageValidity};