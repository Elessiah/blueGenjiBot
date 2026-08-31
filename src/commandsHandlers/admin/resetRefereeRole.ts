import {ChatInputCommandInteraction, Client} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * Retire le rôle arbitre du serveur courant.
 *
 * Les signalements envoyés depuis le site continuent d'arriver dans le canal de
 * logs : seuls les messages privés aux arbitres cessent.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function resetRefereeRole(client: Client,
                                interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await safeReply(interaction, "Cette commande est utilisable uniquement sur un serveur.");
        return;
    }
    if (!(await checkPermissions(interaction))) {
        await safeReply(interaction, "Vous devez être administrateur du serveur pour retirer le rôle arbitre.");
        return;
    }
    const bdd: Bdd = await getBddInstance();
    const removed: boolean = await bdd.removeRefereeRole(interaction.guild.id);
    if (!removed) {
        await safeReply(interaction, "Aucun rôle arbitre n'était configuré sur ce serveur.");
        return;
    }
    await safeReply(interaction, "Rôle arbitre retiré. Les signalements du site n'arriveront plus que dans le canal de logs.");
    await sendLog(client, `/reset-referee-role: ${interaction.guild.id}`);
}

export {resetRefereeRole};
