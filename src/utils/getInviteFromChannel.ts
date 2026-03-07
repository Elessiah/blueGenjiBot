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
        if ((error as TypeError).message.includes("Missing Permissions")) {
            await contactAdminServer(
                client,
                undefined,
                channel.guild.id,
                "\n" +
                "@silent Sorry to bother you.\n" +
                "\n" +
                "I updated the bot to clean the invite channels it accidentally created. However, it now seems that the permission to create invitation links has been removed. The bot will now only create one invitation link.\n" +
                "\n" +
                "You received this message because the bot attempted to create an invitation link for a message footer or for the `listPartner` command.\n" +
                "\n" +
                "Sorry again for the disturbance. If needed, you can contact me: elessiah.\n" +
                "\n" +
                "Best regards,  \n" +
                "Elessiah\n" +
                "\n");
            await sendLog(client, "Message envoyé au admin du serveur : " + channel.guild.name + "pour manque de permission pour créer une invitation.");
        }
        return "";
    }
}

export {getInviteFromChannel};