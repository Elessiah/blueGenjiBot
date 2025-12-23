import {ranksMatch, ranks} from './globals.js';
import {normalizeText} from "./normalizeText.js";
import {answerTmp} from "./answerTmp.js";
import type {Client, Message} from "discord.js";

async function extractRanks(client: Client,
                            message: Message,
                            silence: boolean = false): Promise<string[]> {
    let matchs: string[] = [];
    const cleanMessage = normalizeText(message.content);
    for (const [key, value] of Object.entries(ranksMatch)) {
        const safeKey = key.replace(/\s+/g, '\\s*');
        const regex = new RegExp(`\\b${safeKey}\\s*\\d*\\b`, 'i');
        if (regex.test(cleanMessage)) {
            matchs.push(value);
        }
    }
    if (matchs.length === 0) {
        if (!silence) {
            answerTmp(client,
                message,
                "It seems that you didn't specify any rank. To get more responses from other users, I recommend specifying the rank range you're looking for.",
                30000);
        }
        matchs = ranks;
    }
    return matchs;
}

export {extractRanks};