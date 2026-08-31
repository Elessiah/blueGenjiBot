import {ChatInputCommandInteraction, Client, Role} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {status} from "@/types.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * Désigne le rôle arbitre du serveur courant.
 *
 * Ce rôle reçoit en message privé les signalements de problème envoyés depuis
 * le site par les joueurs inscrits à un tournoi. Sans rôle configuré, les
 * signalements n'arrivent que dans le canal de logs.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function setRefereeRole(client: Client,
                              interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await safeReply(interaction, "Cette commande est utilisable uniquement sur un serveur.");
        return;
    }
    if (!(await checkPermissions(interaction))) {
        await safeReply(interaction, "Vous devez être administrateur du serveur pour définir le rôle arbitre.");
        return;
    }
    const role: Role = interaction.options.getRole("role", true) as Role;
    const bdd: Bdd = await getBddInstance();
    const result: status = await bdd.setRefereeRole(interaction.guild.id, role.id, interaction.user.id);
    if (!result.success) {
        await safeReply(interaction, "Échec de l'enregistrement du rôle arbitre. Veuillez réessayer.");
        await sendLog(client, `setRefereeRole error (${interaction.guild.id}): ${result.message}`);
        return;
    }
    await safeReply(interaction, `Rôle arbitre enregistré : ${role.name}. Ses membres recevront les signalements du site en message privé.`);
    await sendLog(client, `/set-referee-role: ${interaction.guild.id} -> ${role.id}`);
}

export {setRefereeRole};
