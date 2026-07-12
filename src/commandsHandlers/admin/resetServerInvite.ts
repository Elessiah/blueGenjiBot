import {ChatInputCommandInteraction, Client} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * Supprime le lien d'invitation personnalisé du serveur courant.
 * Les liens redeviennent alors auto-générés depuis le salon d'origine.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function resetServerInvite(client: Client,
                                 interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await safeReply(interaction, "Cette commande est utilisable uniquement sur un serveur.");
        return;
    }
    if (!(await checkPermissions(interaction))) {
        await safeReply(interaction, "Vous devez être administrateur du serveur pour retirer le lien d'invitation.");
        return;
    }
    const bdd: Bdd = await getBddInstance();
    const removed: boolean = await bdd.removeServerInvite(interaction.guild.id);
    if (!removed) {
        await safeReply(interaction, "Aucun lien d'invitation personnalisé à retirer sur ce serveur.");
        return;
    }
    await safeReply(interaction, "Lien d'invitation personnalisé retiré. Les liens seront de nouveau générés automatiquement.");
    await sendLog(client, `/reset-server-invite: ${interaction.guild.id}`);
}

export {resetServerInvite};
