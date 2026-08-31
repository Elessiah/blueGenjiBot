import {ChatInputCommandInteraction, Client} from "discord.js";
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
    // `getRole` rend un `Role` sur un serveur, un `APIRole` sur une commande
    // installée hors guilde : seuls `id` et `name` sont lus, communs aux deux.
    const role = interaction.options.getRole("role", true);
    // `@everyone` porte l'identifiant du serveur. L'accepter ferait envoyer un
    // message privé à TOUT le serveur à chaque signalement — du spam de masse,
    // que Discord sanctionne par une suspension du bot.
    if (role.id === interaction.guild.id) {
        await safeReply(interaction, "`@everyone` ne peut pas être le rôle arbitre : chaque signalement enverrait un message privé à tout le serveur. Choisissez un rôle dédié.");
        return;
    }
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
