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
    const success: boolean = false;
    let nTry: number = 0;
    while (nTry < 10 && !success) {
        try {
            // `channelDelete` arrive pour tout salon supprimé de tout serveur :
            // un salon jamais relayé n'a rien à annoncer au journal. Ses
            // éventuels filtres de rang partent quand même, comme avant : ils
            // n'ont pas d'identifiant de serveur, rien d'autre ne les retrouverait.
            const relayed = await bdd.get("ChannelPartner", ["id_channel"], {}, {query: "id_channel = ?", values: [channel_id]}) as {id_channel: string}[];
            if (relayed.length === 0) {
                await bdd.rm("ChannelPartnerRank", {}, {query: "id_channel = ?", values: [channel_id]});
                return {success: true, message: "Ce salon n'est pas relayé."};
            }
            const ret: status = await bdd.deleteChannel(channel_id);
            if (ret.success) {
                // Le nom du serveur ne sert qu'au journal. Sur `channelDelete`
                // le salon n'existe plus chez Discord : la relecture échoue, et
                // la suppression, faite, reste un succès — la retenter dix
                // fois ne la rendrait pas plus faite.
                let where = `channel ${channel_id}`;
                try {
                    const channel = await client.channels.fetch(channel_id) as TextChannel | null;
                    if (channel) {
                        const guild: Guild = channel.guild;
                        where = guild.name;
                    }
                } catch { /* salon supprimé : on journalise son identifiant */ }
                await sendLog(client, 'A service has been unlinked from a channel of ' + where + '.');
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
    const ret: status = await _resetChannel(client, channel_id);
    if (!ret.success) {
        if (ret.message !== "Channel has no services to delete.")
            await sendLog(interaction.client, "resetChannel failed : \n" + ret.message);
    }
    return await safeReply(interaction, ret.message, true, true);
}

export { resetChannel, _resetChannel };

