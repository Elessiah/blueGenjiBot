import {ChatInputCommandInteraction, Client, Role} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";

/**
 * Affiche le rôle arbitre configuré sur le serveur courant.
 * @param _client Client Discord (non utilisé, signature commune aux handlers).
 * @param interaction Interaction utilisateur en cours.
 */
async function showRefereeRole(_client: Client,
                               interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await safeReply(interaction, "Cette commande est utilisable uniquement sur un serveur.");
        return;
    }
    const bdd: Bdd = await getBddInstance();
    const roleId: string | null = await bdd.getRefereeRole(interaction.guild.id);
    if (!roleId) {
        await safeReply(interaction, "Aucun rôle arbitre n'est configuré. Utilisez `/set-referee-role` pour en définir un.");
        return;
    }
    // Le rôle peut avoir été supprimé depuis sa configuration : on le dit plutôt
    // que d'afficher un identifiant nu.
    const role: Role | null = await interaction.guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
        await safeReply(interaction, `Le rôle arbitre configuré (\`${roleId}\`) n'existe plus sur ce serveur. Redéfinissez-le avec \`/set-referee-role\`.`);
        return;
    }
    // Pas de décompte de membres : `role.members` ne reflète que le cache, et
    // afficher « 0 membre » sur un rôle bien peuplé ferait douter d'une
    // configuration pourtant correcte. Forcer la récupération complète des
    // membres sur une commande ouverte à tous serait, elle, disproportionnée.
    await safeReply(interaction, `Rôle arbitre : ${role.name}. Ses membres reçoivent les signalements du site en message privé.`);
}

export {showRefereeRole};
