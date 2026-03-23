import type {ChatInputCommandInteraction, Client, TextChannel} from "discord.js";

import type {Bdd} from "@/bdd/Bdd.js";
import {getBddInstance} from '@/bdd/Bdd.js';
import type {Ban} from "@/bdd/types.js";
import {safeReply} from "@/safe/safeReply.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * Affiche la liste paginée des utilisateurs bannis.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function banlist(client: Client,
                       interaction: ChatInputCommandInteraction): Promise<void> {
    const bdd: Bdd = await getBddInstance();
    const ban_users: Ban[] = await bdd.get("Ban") as Ban[];
    if (ban_users.length === 0) {
        await safeReply(interaction, "There is no banned users");
        return;
    }
    let msg: string = "Banned users :\n";
    for (const user of ban_users) {
        let banned: string;
        let moderator: string;
        let reason: string;
        try {
            banned = (await client.users.fetch(user.id_user)).username;
        } catch (e) {
            banned = "Unknown User";
        }
        try {
            moderator = (await client.users.fetch(user.id_moderator)).username;
        } catch (e) {
            moderator = "Unknown Moderator";
        }
        try {
            const channel: TextChannel | null = await client.channels.fetch(process.env.INFO_SERV!) as TextChannel | null;
            if (!channel) {
                await sendLog(client, "Log channel was not found !");
                reason = "Unknown Reason";
            } else {
                reason = (await (channel).messages.fetch(user.id_reason)).content;
            }
        } catch (e) {
            reason = "UnknownReason";
            await sendLog(client, "Error while retrieving ban reason : " + (e as TypeError).message);
        }
        msg += ` - \`${banned}\` banned by \`${moderator}\` for the \`${reason}\` (${user.date}). ID ban : ${user.id_user}\n`;
    }
    await safeReply(interaction, msg);
}

export {banlist};
