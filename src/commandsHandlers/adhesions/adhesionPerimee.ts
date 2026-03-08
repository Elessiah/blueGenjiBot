import { safeUser } from "@/safe/safeUser.js";
import { Client } from "discord.js";

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