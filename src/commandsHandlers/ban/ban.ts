import type {ChatInputCommandInteraction, Client, Guild, User} from "discord.js";
import { MessageFlags } from "discord.js";

import {getBddInstance} from "../../bdd/Bdd.js";
import {deleteDPMsgs} from "../../bdd/deleteDPMsgs.js";
import {checkBan} from "../../check/checkBan.js";
import {checkPermissions} from "../../check/checkPermissions.js";
import {safeReply} from "../../safe/safeReply.js";
import {sendLog} from "../../safe/sendLog.js";
import type {idSendLogMsg} from "../../safe/types.js";

async function ban(client: Client,
                   interaction: ChatInputCommandInteraction,
                   user: User,
                   reason: string): Promise<boolean> {
    await interaction.deferReply({flags: MessageFlags.Ephemeral });
    const guild: Guild | null = interaction.guild;
    if (!guild) {
        await safeReply(interaction, "Error occured while checking your right to ban... Guild was not into the interaction. Please try again !", true, true);
        return false;
    }
    if (guild.id !== process.env.SERV_RIVALS && guild.id !== process.env.SERV_GENJI && guild.memberCount < 50) {
        await safeReply(interaction, "Your server doesn't have enough members to ban users.\n" +
            "A minimum of 50 members is required.\n" +
            "If necessary, please contact 'Elessiah' or the administrators of a server that meets the requirements to take appropriate measures.\n",
            true,
            true);
        return false;
    }
    if (!checkPermissions(interaction)) {
        await safeReply(interaction, "You don't have permission to ban users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n",
            true,
            true);
        return false;
    }
    const bdd = await getBddInstance();
    if (!bdd) {
        await sendLog(client, "Bdd failed in ban !");
        return false;
    }
    if (await checkBan(client, user.id, false)) {
        await safeReply(interaction, "This user has been already banned.", true, true);
        return true;
    }
    await sendLog(client, "**" + user.username + "** *has been banned by " + interaction.user.username + "*");
    const ids: idSendLogMsg = {admin: "", owner: ""};
    await sendLog(client, "**Reason:** " + reason, ids);
    try {
        await bdd.set('Ban', ['id_user', 'id_moderator', 'id_reason'], [user.id, interaction.user.id, ids.admin]);
    } catch (e) {
        await sendLog(client, 'Error while register ban : ' + (e as TypeError).message);
        return false;
    }
    const OGMsgs: {id_msg: string}[] = await bdd.get('OGMsg', ['id_msg'], {}, {query: "id_author = ?", values: [user.id]}) as {id_msg: string}[];
    for (const OGMsg of OGMsgs) {
        await deleteDPMsgs(client, OGMsg.id_msg);
    }
    await safeReply(interaction, "Member has been successfully banned !", true, true);
    return true;
}

export {ban};