import {ChatInputCommandInteraction, Client} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";

/**
 * Supprime la configuration d'adhésion enregistrée pour le serveur.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function deleteSetupAdhesion(client: Client,
                                   interaction: ChatInputCommandInteraction): Promise<void> {
    const targetId: number | null = interaction.options.getInteger("id-rappel");

    if (targetId === null) {
        await safeReply(interaction, "Pas d'ID cible. Essaie encore plus tard.");
        return;
    }

    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get("AdhesionInterval", ["id"], undefined, {query: "id = ?", values: [targetId]});
    if (result.length === 0) {
        await safeReply(interaction, "Le rappel d'adhésion n°" + targetId + " est introuvable.");
        return;
    }
    await bdd.rm("AdhesionInterval", undefined, {query: "id = ?", values: [targetId]});
    await safeReply(interaction, "Rappel n°" + targetId + " a été supprimé !");
}

export { deleteSetupAdhesion };
