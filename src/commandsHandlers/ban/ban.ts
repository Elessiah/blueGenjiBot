import type {ChatInputCommandInteraction, Client, Guild, User} from "discord.js";
import { MessageFlags } from "discord.js";

import {getBddInstance} from "@/bdd/Bdd.js";
import {deleteDPMsgs} from "@/bdd/deleteDPMsgs.js";
import {checkBan} from "@/check/checkBan.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {safeReply} from "@/safe/safeReply.js";
import {sendLog} from "@/safe/sendLog.js";
import type {idSendLogMsg} from "@/safe/types.js";

/**
 * Ban un utilisateur des utilisations du bot discord.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 * @param user Utilisateur concerne.
 * @param reason Motif fourni pour le bannissement.
 * @returns `true` si l'utilisateur est déjà banni ou banni avec succès; `false` si préconditions/permissions échouent ou erreur base/log.
 */
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
    if (!(await checkPermissions(interaction))) {
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
    const banVerdict = await checkBan(client, user.id, false);
    if (banVerdict === "BANNED") {
        await safeReply(interaction, "This user has been already banned.", true, true);
        return true;
    }
    // Verdict indisponible : on refuse plutot que de bannir a l'aveugle. La
    // ligne `Ban` n'a pas de cle sur `id_user`, un second bannissement du meme
    // compte en creerait donc un doublon -- et le motif publie au salon
    // d'administration l'aurait ete pour rien.
    if (banVerdict === "UNKNOWN") {
        await safeReply(interaction, "Ban database unreachable, please try again in a moment.", true, true);
        return false;
    }
    // Identifiants, jamais de pseudos, au journal : un pseudo se change et se
    // lit par quiconque voit le salon, l'identifiant suffit à retrouver le compte.
    // Les identifiants des messages de l'exclusion (avis au salon, motif au
    // salon et en message privé au propriétaire) sont gardés avec elle :
    // `/unban` les efface, et la purge d'un an du journal les épargne tant
    // qu'elle dure. L'avis ne part qu'au salon, comme avant (`copyToOwner`).
    const notice: idSendLogMsg = {admin: "", owner: ""};
    await sendLog(client, `*Un joueur (id ${user.id}) a été exclu par un modérateur (id ${interaction.user.id}).*`, notice, false);
    const ids: idSendLogMsg = {admin: "", owner: ""};
    await sendLog(client, "**Reason:** " + reason, ids);
    // `set` ne lève pas : il rend son échec (colonne absente si la migration
    // a échoué, base verrouillée). Sans ce contrôle, l'exclusion n'était pas
    // écrite alors que le modérateur lisait « banned ».
    let failure: string | null = null;
    try {
        const status = await bdd.set('Ban',
            ['id_user', 'id_moderator', 'id_reason', 'id_reason_owner', 'id_notice_admin'],
            [user.id, interaction.user.id, ids.admin, ids.owner || null, notice.admin || null]);
        if (!status.success) {
            failure = status.message;
        }
    } catch (e) {
        failure = (e as TypeError).message;
    }
    if (failure !== null) {
        await sendLog(client, 'Error while register ban : ' + failure);
        await safeReply(interaction, "Ban could not be recorded, please try again in a moment.", true, true);
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
