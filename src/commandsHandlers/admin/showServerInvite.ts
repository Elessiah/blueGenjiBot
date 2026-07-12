import {ChatInputCommandInteraction, Client} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";

/**
 * Affiche le lien d'invitation personnalisé configuré pour le serveur courant.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function showServerInvite(client: Client,
                                interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await safeReply(interaction, "Cette commande est utilisable uniquement sur un serveur.");
        return;
    }
    const bdd: Bdd = await getBddInstance();
    const invite: string | null = await bdd.getServerInvite(interaction.guild.id);
    if (!invite) {
        await safeReply(interaction, "Aucun lien d'invitation personnalisé. Le lien est généré automatiquement depuis le salon d'origine.");
        return;
    }
    await safeReply(interaction, `Lien d'invitation personnalisé de ce serveur : ${invite}`);
}

export {showServerInvite};
