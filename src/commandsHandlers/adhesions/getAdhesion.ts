import {type ChatInputCommandInteraction, GuildMember} from "discord.js";
import type { Client, TextChannel, Role } from "discord.js";
import {sendLog} from "@/safe/sendLog.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {safeFollowUp} from "@/safe/safeFollowUp.js";
import {safeReply} from "@/safe/safeReply.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {status} from "@/types.js";
import {sendAdhesion} from "@/adhesion/sendAdhesion.js";

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
    let message: string | null = interaction.options.getString("message");
    const channel: TextChannel | null = interaction.options.getChannel("channel");
    const member: GuildMember | null = interaction.options.getMember("membre") as GuildMember | null;
    const role: Role | null = interaction.options.getRole("role") as Role | null;
    const interval: string | null = interaction.options.getString("interval");
    let intInterval: number = 0;
    if (interval != null) {
        intInterval = parseInt(interval, 10);
    }
    let memberPermMissing = !checkPermissions(interaction);
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
        const nextTransmission: Date = new Date();
        nextTransmission.setHours(10, 0, 0, 0);
        nextTransmission.setDate(nextTransmission.getDate() + intInterval);
        const bdd: Bdd = await getBddInstance();
        const status: status = await bdd.set(
            "AdhesionInterval",
            [
                "message",
                "guild_id",
                "channel_id",
                "member_id",
                "role_id",
                "author_id",
                "interval_days",
                "nextTransmission",
            ],
            [
                message,
                interaction.guild.id,
                channel ? channel.id : null,
                member ? member.id : null,
                role ? role.id : null,
                interaction.user.id,
                interval,
                nextTransmission.toISOString(),
            ]
        );
        if (!status.success) {
            await sendLog(client, "Erreur lors de la programmation d'un rappel : " + status.message);
            await safeFollowUp(
                interaction,
                "Echec de la programmation ! Veuillez réessayer !",
                true,
                []
            );
            return;
        }
        await safeFollowUp(
            interaction,
            `Programmation réussi du rappel. Envoi des adhésions dans ${interval} jours`,
            false,
            []
        );
    }
}

export {getAdhesion};
