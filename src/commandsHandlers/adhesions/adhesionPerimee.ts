/**
 * Handler de commande signalant a un membre que son adhesion a l'association est perimee.
 *
 * Envoie un message prive independant du parcours automatique
 * `setupIntervalAdhesion` (voir `adhesion/checkIntervalleAdhesion.ts`) : c'est
 * le rappel manuel qu'un admin declenche pour un cas particulier, avec un
 * texte personnalisable, plutot que le message par defaut de l'echeance
 * programmee.
 */

import { safeUser } from "../../safe/safeUser.js";
import { safeReply } from "../../safe/safeReply.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";

/**
 * @param client Client Discord, transmis a `safeUser` pour l'envoi du DM.
 * @param interaction Interaction de la commande `/adhesion-perimee`.
 */
async function adhesionPerimee(client: Client,
                                interaction: ChatInputCommandInteraction): Promise<void> {
    // Récupère l'utilisateur et le message depuis les options de la commande
    const user = interaction.options.getUser("user");
    let message = interaction.options.getString("message");

    if (!user) {
        await safeReply(interaction, "Utilisateur non trouvé dans les options !", true);
        return;
    }

    if (!message) {
        message = "Votre adhésion à l'association est à présent périmée. Pour la renouveler, veuillez contacter le bureau ou utiliser la commande dédiée.";
    }

    // `safeUser` ne lève pas : un message non remis se lit à son `null`, et
    // `safeUser` l'a déjà journalisé. `safeReply` ne lève pas non plus.
    const sent = await safeUser(client, user, undefined, [], message);
    if (sent) {
        await safeReply(interaction, `Message d'adhésion périmée envoyé à ${user.toString()} !`, true);
    } else {
        await safeReply(interaction, "Erreur lors de l'envoi du message à l'utilisateur.", true);
    }
}

export {adhesionPerimee};