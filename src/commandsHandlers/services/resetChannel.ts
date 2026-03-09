import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {sendLog} from "@/safe/sendLog.js";
import {safeReply} from "@/safe/safeReply.js";
import {type ChatInputCommandInteraction, type Client, type Guild, MessageFlags, type TextChannel} from "discord.js";
import {status} from "@/types.js";

/**
 * Réinitialise en base la configuration d'un salon cible.
 * @param client Client Discord utilisé pour les appels API.
 * @param channel_id Identifiant du salon cible.
 * @returns Objet `status` avec `success=true` si la suppression des liens du salon réussit, sinon `success=false` et un message d'erreur.
 */
async function _resetChannel(client: Client, channel_id: string): Promise<status> {
    const bdd: Bdd = await getBddInstance();
    let err_msg: string = "";
    let success: boolean = false;
    let nTry: number = 0;
    while (nTry < 10 && !success) {
        try {
            await bdd.rm("ChannelPartnerRank", {}, {query: "id_channel = ?", values: [channel_id]});
            const ret: status = await bdd.deleteChannelServices(channel_id);
            if (ret.success) {
                let channel: TextChannel | null = await client.channels.fetch(channel_id) as TextChannel | null;
                if (!channel) {
                    await sendLog(client, "Failed to retrieve the targeted channel to reset");
                    return {success: false, message: "Failed, retrieving targeted channel to reset!"};
                }
                const guild: Guild = channel.guild;
                const content: string = 'A service has been unlinked from a channel of ' + guild.name + '.';
                await sendLog(client, content);
                return {success: true, message: `Channel reseted`};
            } else {
                return {success: false, message: ret.message};
            }
        } catch (err) {
            err_msg = (err as TypeError).message;
            nTry++;
        }
    }
    if (nTry === 10) {
        return { success: false, message: err_msg + "\n Please contact elessiah" };
    }
    return {success: true, message: ""};
}

/**
 * Traite la commande de réinitialisation d'un salon.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 * @returns `false` si permissions refusées, salon manquant ou échec d'envoi de la réponse finale; `true` sinon.
 */

async function resetChannel(client: Client, interaction: ChatInputCommandInteraction): Promise<boolean> {
    if (!(await checkPermissions(interaction))) {
        return await safeReply(interaction, "You don't have the permission to do this.", true);
    }
    await interaction.deferReply({flags: MessageFlags.Ephemeral});
    const channel: TextChannel | null = interaction.options.getChannel("channel") as TextChannel | null;
    if (!channel) {
        await safeReply(interaction, "Missing target channel !", true, true);
        return false;
    }
    const channel_id: string = channel.id;
    let ret: status = await _resetChannel(client, channel_id);
    if (!ret.success) {
        if (ret.message !== "Channel has no services to delete.")
            await sendLog(interaction.client, "resetChannel failed : \n" + ret.message);
    }
    return await safeReply(interaction, ret.message, true, true);
}

export { resetChannel, _resetChannel };

