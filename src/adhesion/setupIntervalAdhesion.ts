import type { ChatInputCommandInteraction, Client, GuildMember, Role, TextChannel } from "discord.js";
import { sendLog } from "@/safe/sendLog.js";
import { safeFollowUp } from "@/safe/safeFollowUp.js";
import { Bdd, getBddInstance } from "@/bdd/Bdd.js";
import type { status } from "@/types.js";
import { toSQLiteDate } from "@/utils/toSQLiteDatetime.js";

/**
 * Programme un rappel d'adhésion à intervalle régulier dans la base de données.
 * @param client Client Discord utilisé pour les logs.
 * @param interaction Interaction utilisateur pour les réponses.
 * @param message Message personnalisé à joindre aux adhésions.
 * @param channel Canal cible, ou null.
 * @param member Membre cible, ou null.
 * @param role Rôle cible, ou null.
 * @param interval Intervalle en jours (chaîne).
 * @param intInterval Intervalle en jours (nombre).
 */
export async function setupIntervalAdhesion(
    client: Client,
    interaction: ChatInputCommandInteraction,
    message: string | null,
    channel: TextChannel | null,
    member: GuildMember | null,
    role: Role | null,
    intInterval: number,
    nextTransmission: Date,
    iteration?: number
): Promise<void> {
    if (!interaction.guild) return;

    const bdd: Bdd = await getBddInstance();
    const result: status = await bdd.set(
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
            "iteration",
        ],
        [
            message,
            interaction.guild.id,
            channel ? channel.id : null,
            member ? member.id : null,
            role ? role.id : null,
            interaction.user.id,
            intInterval,
            toSQLiteDate(nextTransmission),
            iteration ? iteration : -1,
        ]
    );

    if (!result.success) {
        await sendLog(client, "Erreur lors de la programmation d'un rappel : " + result.message);
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
        `Programmation réussi du rappel. Envoi des adhésions dans ${intInterval} jours`,
        false,
        []
    );
}
