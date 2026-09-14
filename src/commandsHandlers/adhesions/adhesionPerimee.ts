/**
 * Handler de commande signalant a un membre que son adhesion a l'association est perimee.
 *
 * Envoie un message prive independant du parcours automatique
 * `setupIntervalAdhesion` (voir `adhesion/checkIntervalleAdhesion.ts`) : c'est
 * le rappel manuel qu'un admin declenche pour un cas particulier, avec un
 * texte personnalisable, plutot que le message par defaut de l'echeance
 * programmee.
 */

import { safeUser } from "@/safe/safeUser.js";
import { Client } from "discord.js";

/**
 * @param client Client Discord, transmis a `safeUser` pour l'envoi du DM.
 * @param interaction Interaction de la commande (typee `any` : options lues au vol, sans type Discord.js dedie).
 */
async function adhesionPerimee(client: Client,
                                interaction: any): Promise<void> {
    // Récupère l'utilisateur et le message depuis les options de la commande
    const user = interaction.options.getUser("user");
    let message = interaction.options.getString("message");

    if (!user) {
        await interaction.reply({
            content: "Utilisateur non trouvé dans les options !",
            ephemeral: true
        });
        return;
    }

    if (!message) {
        message = "Votre adhésion à l'association est à présent périmée. Pour la renouveler, veuillez contacter le bureau ou utiliser la commande dédiée.";
    }

    try {
        await safeUser(client, user, undefined, [], message);
        await interaction.reply({
            content: `Message d'adhésion périmée envoyé à ${user.toString()} !`,
            ephemeral: true
        });
    } catch (err) {
        await interaction.reply({
            content: "Erreur lors de l'envoi du message à l'utilisateur.",
            ephemeral: true
        });
    }
}

export {adhesionPerimee};