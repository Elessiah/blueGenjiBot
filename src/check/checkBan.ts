import type {Client, TextChannel, User} from "discord.js";

import type {Bdd} from "../bdd/Bdd.js";
import { getBddInstance} from "../bdd/Bdd.js";
import {safeUser} from "../safe/safeUser.js";
import {sendLog} from "../safe/sendLog.js";


import type {BanInfo} from "./types.js";

async function checkBan(client: Client,
                        id_author: string,
                        alertUser: boolean = true): Promise<boolean> {
    try {
        const bdd: Bdd = await getBddInstance();
        let isBanned: boolean = false;
        let banInfo: BanInfo;
        try {
            const result: BanInfo[] = (await bdd.get("Ban",
                ['id_user', 'id_reason', 'date'],
                {},
                {query: "id_user = ?", values: [id_author]}) as BanInfo[]);
            isBanned = result.length > 0;
            banInfo = result[0];
        } catch (e) {
            await sendLog(client, "Failed to check ban : " + (e as TypeError).message);
            return false;
        }
        if (!isBanned) {
            return false;
        } else if (!alertUser) {
            return true;
        }
        const user: User = await client.users.fetch(banInfo.id_user);
        const logChannel: TextChannel = await client.channels.fetch(process.env.INFO_SERV!) as TextChannel;
        if (!logChannel) {
            await sendLog(client, "Failed to fetch admin channel for ban reason");
            return true;
        }
        const reasonMsg = await logChannel.messages.fetch(banInfo.id_reason);
        if (!reasonMsg) {
            await sendLog(client, "Failed to fetch ban reason in admin channel");
            return true;
        }
        const banReason = "You have been banned since " + banInfo.date + " : \n" + reasonMsg.content;
        await safeUser(client, user, undefined, [], banReason);
        return true;
    } catch (error) {
        await sendLog(client, "Error while checking ban : " + (error as TypeError).message);
        return false;
    }
}

export {checkBan};