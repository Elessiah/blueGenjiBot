import {ChatInputCommandInteraction, Client} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {status} from "@/types.js";
import {sendLog} from "@/safe/sendLog.js";
import {isDiscordInvite, normalizeInvite} from "@/utils/isDiscordInvite.js";

/**
 * Associe un lien d'invitation personnalisé au serveur courant.
 * Ce lien est utilisé en priorité dans les messages de service et la liste des partenaires,
 * à la place de l'invitation auto-générée sur le salon d'origine.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function setServerInvite(client: Client,
                               interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await safeReply(interaction, "Cette commande est utilisable uniquement sur un serveur.");
        return;
    }
    if (!(await checkPermissions(interaction))) {
        await safeReply(interaction, "Vous devez être administrateur du serveur pour définir un lien d'invitation.");
        return;
    }
    const rawInvite: string = interaction.options.getString("invite", true);
    if (!isDiscordInvite(rawInvite)) {
        await safeReply(interaction, "Lien invalide. Fournissez un lien d'invitation Discord (ex: `https://discord.gg/xxxxxx`).");
        return;
    }
    const invite: string = normalizeInvite(rawInvite);
    const bdd: Bdd = await getBddInstance();
    const result: status = await bdd.setServerInvite(interaction.guild.id, invite, interaction.user.id);
    if (!result.success) {
        await safeReply(interaction, "Échec de l'enregistrement du lien d'invitation. Veuillez réessayer.");
        await sendLog(client, `setServerInvite error (${interaction.guild.id}): ${result.message}`);
        return;
    }
    await safeReply(interaction, `Lien d'invitation personnalisé enregistré : ${invite}`);
    await sendLog(client, `/set-server-invite: ${interaction.guild.id} -> ${invite}`);
}

export {setServerInvite};
