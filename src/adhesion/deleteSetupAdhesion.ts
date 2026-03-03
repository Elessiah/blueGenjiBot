import {ChatInputCommandInteraction, Client} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";

async function deleteSetupAdhesion(client: Client,
                                   interaction: ChatInputCommandInteraction): Promise<void> {
    const targetId: number | null = interaction.options.getInteger("id-rappel");

    if (!targetId) {
        await safeReply(interaction, "Pas d'ID cible. Essaie encore plus tard.");
        return;
    }

    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get("AdhesionInterval", ["id"], undefined, {query: "id = ?", values: [targetId]});
    if (!result) {
        await safeReply(interaction, "Le rappel d'interval n°" + targetId + " est introuvable.");
        return;
    }
    await bdd.rm("AdhesionInterval", undefined, {query: "id = ?", values: [targetId]});
    await safeReply(interaction, "Remove " + targetId);
}

export { deleteSetupAdhesion };