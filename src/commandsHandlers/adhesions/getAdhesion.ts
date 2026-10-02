import {type ChatInputCommandInteraction, type Client, GuildMember, type Role, type TextChannel} from "discord.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {safeFollowUp} from "@/safe/safeFollowUp.js";
import {safeReply} from "@/safe/safeReply.js";
import {sendAdhesion} from "@/adhesion/sendAdhesion.js";
import {setupIntervalAdhesion} from "@/adhesion/setupIntervalAdhesion.js";
import {nextTransmissionAfter} from "@/adhesion/nextTransmission.js";
import {collectRecipients, isEveryoneRole, MAX_ADHESION_DMS} from "@/adhesion/adhesionRecipients.js";
import {EVERYONE_REFUSED_NOTICE, recipientCapNotice, roleUnreadableNotice} from "@/adhesion/adhesionNotices.js";

/** Ajouté à un refus prononcé à la création d'un rappel. */
const REMINDER_NOT_SAVED = " Aucun rappel n'a été enregistré.";

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
    // Sans permission, rien ne part vers le rôle : l'auteur reçoit sa copie.
    if (!memberPermMissing && role !== null && await refusedRole(client, interaction, role, member, intInterval)) {
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

/**
 * Refuse, avant tout envoi et avant d'enregistrer un rappel, un rôle que
 * l'envoi refuserait de toute façon : `@everyone`, et, pour un rappel, un rôle
 * au-delà de `MAX_ADHESION_DMS` messages privés (sinon le rappel serait
 * enregistré puis refusé à chaque échéance). Un envoi immédiat vérifie le
 * plafond à l'envoi même, sans seconde lecture ici.
 * @param client Client Discord utilisé pour le journal.
 * @param interaction Interaction en cours, qui reçoit le refus.
 * @param role Rôle visé.
 * @param member Membre désigné en même temps, ou `null`.
 * @param intInterval Intervalle du rappel demandé, `0` sans rappel.
 * @returns `true` si l'envoi est refusé (l'auteur en est avisé).
 */
async function refusedRole(client: Client,
                           interaction: ChatInputCommandInteraction,
                           role: Role,
                           member: GuildMember | null,
                           intInterval: number): Promise<boolean> {
    if (isEveryoneRole(role)) {
        await safeFollowUp(interaction, EVERYONE_REFUSED_NOTICE, true, []);
        return true;
    }
    // Un intervalle illisible (`NaN`) n'est pas un rappel, pas plus que `0`.
    if (Number.isNaN(intInterval) || intInterval <= 0) return false;
    const {recipients, roleCount, roleUnreadable} = await collectRecipients(client, role, member);
    // Rôle illisible : le plafond ne peut pas être vérifié, le rappel n'est pas
    // enregistré (la lecture en échec est déjà journalisée).
    if (roleUnreadable) {
        await safeFollowUp(interaction, roleUnreadableNotice(role.name) + REMINDER_NOT_SAVED, true, []);
        return true;
    }
    if (recipients.length <= MAX_ADHESION_DMS) return false;
    await safeFollowUp(interaction,
        recipientCapNotice(role.name, roleCount, recipients.length, MAX_ADHESION_DMS) + REMINDER_NOT_SAVED,
        true, []);
    return true;
}

export {getAdhesion};
