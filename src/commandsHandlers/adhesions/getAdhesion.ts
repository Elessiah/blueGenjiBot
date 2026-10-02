import {type ChatInputCommandInteraction, type Client, GuildMember, type Role, type TextChannel} from "discord.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {safeFollowUp} from "@/safe/safeFollowUp.js";
import {safeReply} from "@/safe/safeReply.js";
import {sendAdhesion} from "@/adhesion/sendAdhesion.js";
import {setupIntervalAdhesion} from "@/adhesion/setupIntervalAdhesion.js";
import {nextTransmissionAfter} from "@/adhesion/nextTransmission.js";
import {isEveryoneRole} from "@/adhesion/adhesionRecipients.js";
import {EVERYONE_REFUSED_NOTICE} from "@/adhesion/adhesionNotices.js";

/**
 * Récupère et envoie les fichiers d'adhésion configurés.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function getAdhesion(client: Client,
                           interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guild) {
        await safeReply(
            interaction,
            "Impossible d'envoyer des adhésions si vous n'êtes pas sur un serveur ! Réessayer sur un serveur");
        return;
    }
    await safeReply(interaction, "Envoie des adhésions en cours...", true);
    const message: string | null = interaction.options.getString("message");
    const channel: TextChannel | null = interaction.options.getChannel("channel");
    const member: GuildMember | null = interaction.options.getMember("membre") as GuildMember | null;
    const role: Role | null = interaction.options.getRole("role") as Role | null;
    if (role !== null && isEveryoneRole(role)) {
        // Refusé avant tout envoi et avant d'enregistrer un rappel.
        await safeFollowUp(interaction, EVERYONE_REFUSED_NOTICE, true, []);
        return;
    }
    const interval: string | null = interaction.options.getString("interval");
    let intInterval: number = 0;
    if (interval != null) {
        intInterval = Number.parseInt(interval, 10);
    }
    const memberPermMissing = !(await checkPermissions(interaction));
    if (memberPermMissing && intInterval > 0) {
        await safeFollowUp(
            interaction,
            "Vous n'avez pas les permissions pour définir une intervalle",
            true,
            []
        );
        return;
    }
    if (await sendAdhesion(client, message, channel, member, role, memberPermMissing, interaction.user))
        await safeFollowUp(interaction, "Envoi réussi !", true, []);
    else
        await safeFollowUp(interaction, "Echec de l'envoi !", true, []);
    if (intInterval > 0) {
        const nextTransmission: Date = nextTransmissionAfter(new Date(), intInterval);
        await setupIntervalAdhesion(
            client,
            interaction,
            { message, channel, member, role },
            { intInterval, nextTransmission }
        );
    }
}

export {getAdhesion};
