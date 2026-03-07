import type {Client, TextChannel} from "discord.js";
import {contactAdminServer} from "@/commandsHandlers/contactAdminServer.js";
import {sendLog} from "@/safe/sendLog.js";

async function getInviteFromChannel(client: Client, channel: TextChannel): Promise<string> {
    try {
        const invites = await channel.guild.invites.fetch();

        let existing = invites.find(inv =>
            inv.maxAge === 0 &&
            inv.maxUses === 0
        );

        if (!existing) {
            existing = await channel.createInvite({
                maxAge: 0,
                maxUses: 0,
                unique: false
            });
        }

        return existing.url;
    } catch (error) {
        console.log("Erreur getInviteFromChannel: ", (error as TypeError).message);
        return "";
    }
}

export {getInviteFromChannel};