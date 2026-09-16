import type { ChatInputCommandInteraction, Client, GuildMember, Role, TextChannel } from "discord.js";
import { sendLog } from "@/safe/sendLog.js";
import { safeFollowUp } from "@/safe/safeFollowUp.js";
import { Bdd, getBddInstance } from "@/bdd/Bdd.js";
import type { status } from "@/types.js";
import { toSQLiteDate } from "@/utils/toSQLiteDatetime.js";
import { ITERATION_UNLIMITED, initialIteration } from "@/adhesion/iteration.js";

/**
 * Programme un rappel d'adhésion à intervalle régulier dans la base de données.
 * @param client Client Discord utilisé pour les logs.
 * @param interaction Interaction utilisateur pour les réponses.
 * @param message Message personnalisé à joindre aux adhésions.
 * @param channel Canal cible, ou null.
 * @param member Membre cible, ou null.
 * @param role Rôle cible, ou null.
 * @param intInterval Intervalle en jours.
 * @param nextTransmission Date du premier envoi.
 * @param iteration Nombre d'envois à faire, ou `undefined` pour un rappel sans terme.
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

    // Un rappel qui n'a aucun envoi à faire n'est pas un rappel : on refuse de
    // l'écrire plutôt que de laisser la base décider de ce qu'il devient. Le
    // `iteration ? iteration : -1` d'avant, lui, faisait tomber le zéro du côté
    // falsy et posait un rappel **perpétuel** — l'inverse de la demande.
    const storedIteration: number | null = initialIteration(iteration);
    if (storedIteration === null) {
        await sendLog(client, "Rappel refusé : " + iteration + " n'est pas un nombre d'envois.");
        await safeFollowUp(
            interaction,
            "Impossible de programmer un rappel sans aucun envoi à faire !",
            true,
            []
        );
        return;
    }

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
            storedIteration,
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

    // Le message annonçait « dans N jours » quel que soit l'appelant, ce qui
    // donnait « dans 0 jours » à `/adhesion-valide`, dont l'échéance est une
    // date de péremption et non une cadence. Il dit désormais la seule chose
    // que les deux appelants ont en commun : **quand** part le prochain envoi.
    // `<t:...:F>` et `<t:...:R>` sont rendus par Discord dans le fuseau du
    // lecteur, comme le fait déjà `/show-rappel-adhesion`.
    const quand: number = Math.floor(nextTransmission.getTime() / 1000);
    const suite: string = storedIteration === ITERATION_UNLIMITED
        ? `, puis tous les **${intInterval} jours**`
        : storedIteration > 1 ? `, ${storedIteration} envois au total` : "";
    await safeFollowUp(
        interaction,
        `Rappel programmé. Prochain envoi <t:${quand}:F> (**<t:${quand}:R>**)${suite}.`,
        false,
        []
    );
}
