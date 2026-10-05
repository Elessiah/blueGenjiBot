import type { ChatInputCommandInteraction, Client, GuildMember, Role, TextChannel } from "discord.js";
import { sendLog } from "../safe/sendLog.js";
import { safeFollowUp } from "../safe/safeFollowUp.js";
import { Bdd, getBddInstance } from "../bdd/Bdd.js";
import type { status } from "../types.js";
import { toSQLiteDate } from "../utils/toSQLiteDatetime.js";
import { ITERATION_UNLIMITED, initialIteration } from "./iteration.js";

/** Destinataires d'un rappel : au moins l'un des trois, ou un message seul. */
export interface ReminderTarget {
    /** Message personnalisé à joindre aux adhésions. */
    message: string | null;
    /** Canal cible, ou null. */
    channel: TextChannel | null;
    /** Membre cible, ou null. */
    member: GuildMember | null;
    /** Rôle cible, ou null. */
    role: Role | null;
}

/** Cadence d'un rappel. */
export interface ReminderSchedule {
    /** Intervalle en jours. */
    intInterval: number;
    /** Date du premier envoi. */
    nextTransmission: Date;
    /** Nombre d'envois à faire, ou `undefined` pour un rappel sans terme. */
    iteration?: number;
}

/**
 * Programme un rappel d'adhésion à intervalle régulier dans la base de données.
 * @param client Client Discord utilisé pour les logs.
 * @param interaction Interaction utilisateur pour les réponses.
 * @param target Message et destinataires du rappel.
 * @param schedule Intervalle, premier envoi et nombre d'envois.
 */
export async function setupIntervalAdhesion(
    client: Client,
    interaction: ChatInputCommandInteraction,
    target: ReminderTarget,
    schedule: ReminderSchedule
): Promise<void> {
    const { message, channel, member, role } = target;
    const { intInterval, nextTransmission, iteration } = schedule;
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

    // Deux saisies libres mènent ici, et aucune n'est vérifiée en amont.
    //
    // `/adhesion-valide` construit cette date depuis une saisie annoncée en
    // `jj/mm/aaaa`. Une saisie que `Date` ne comprend pas — la forme ISO, par
    // exemple, que l'on tape par habitude — donne une date invalide, et
    // `toSQLiteDate` levait alors un `RangeError` au beau milieu du handler :
    // le membre vient de recevoir « votre adhésion est validée », aucun
    // rappel n'est posé, et personne ne l'apprend.
    //
    // `/get-adhesion` y mène par l'autre bout : son option `interval` est du
    // texte libre que rien ne borne, et une cadence assez grande sort de ce
    // que `Date` sait représenter. Elle a longtemps été bornée à 20 jours,
    // non par choix de produit mais parce que le rappel était alors un
    // `setInterval` en mémoire, dont le délai tient dans un entier 32 bits
    // signé — 24,86 jours. Le passage à une date en base relevée par cron a
    // retiré le plafond **et** sa raison d'être, dans le même commit. Le seul
    // plafond qui subsiste est celui de `Date`, et c'est lui qu'on tient ici.
    //
    // Le refus est donc ici, où passe l'écriture de **tout** rappel, plutôt
    // que chez l'un des deux appelants.
    if (!Number.isFinite(nextTransmission.getTime())) {
        await sendLog(client, "Rappel refusé : date d'échéance invalide.");
        await safeFollowUp(
            interaction,
            "Échéance invalide : aucun rappel n'a été programmé. Vérifiez la date (jj/mm/aaaa) ou l'intervalle.",
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
    let suite: string = "";
    if (storedIteration === ITERATION_UNLIMITED) suite = `, puis tous les **${intInterval} jours**`;
    else if (storedIteration > 1) suite = `, ${storedIteration} envois au total`;
    await safeFollowUp(
        interaction,
        `Rappel programmé. Prochain envoi <t:${quand}:F> (**<t:${quand}:R>**)${suite}.`,
        false,
        []
    );
}
