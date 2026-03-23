import {ChatInputCommandInteraction, Client, Message, MessageFlags} from "discord.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {safeReply} from "@/safe/safeReply.js";
import {adhesionIntervalIds, adhesionIntervalObj} from "@/adhesion/types.js"
import {fetchTargets} from "@/adhesion/fetchTargets.js";

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} from "discord.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * Formate l'affichage d'une cible utilisateur pour l'embed.
 * @param ai Objet de configuration d'un rappel d'adhésion.
 * @returns Mention utilisateur (`<@id>`) si définie, sinon `—`.
 */

function formatUser(ai: adhesionIntervalObj): string {
    if (ai.member) return `<@${ai.member.id}>`;
    return "—";
}

/**
 * Formate l'affichage d'une cible rôle pour l'embed.
 * @param ai Objet de configuration d'un rappel d'adhésion.
 * @returns Mention rôle (`<@&id>`) si défini, sinon `—`.
 */
function formatRole(ai: adhesionIntervalObj): string {
    if (ai.role) return `<@&${ai.role.id}>`;
    return "—";
}

/**
 * Formate l'affichage d'une cible salon pour l'embed.
 * @param ai Objet de configuration d'un rappel d'adhésion.
 * @returns Mention salon (`<#id>`) si défini, sinon `—`.
 */
function formatChannel(ai: adhesionIntervalObj): string {
    return ai.channel ? `<#${ai.channel.id}>` : "—";
}

/**
 * Convertit un horodatage en format Discord lisible.
 * @param d Date à convertir en timestamp Discord.
 * @returns Timestamp Unix en secondes utilisable dans les balises temporelles Discord.
 */
function ts(d: Date): number {
    return Math.floor(d.getTime() / 1000);
}

/**
 * Construit une page d'embed pour la pagination des configurations d'adhésion.
 * @param items Liste complète des rappels à paginer.
 * @param page Index de page demandé (base 0).
 * @param pageSize Nombre d'éléments à afficher par page.
 * @returns Objet de pagination contenant `embed`, `page` et `totalPages`, avec page bornée sur l'intervalle valide.
 */
function buildEmbedPage(items: adhesionIntervalObj[], page: number, pageSize: number) {
    const totalPages: number = Math.max(1, Math.ceil(items.length / pageSize));
    const p: number = Math.min(Math.max(page, 0), totalPages - 1);
    const slice: adhesionIntervalObj[] = items.filter(i => i.iteration == -1).slice(p * pageSize, p * pageSize + pageSize);

    const desc: string =
        slice.length === 0
            ? "Aucun rappel programmé."
            : slice
                .map((ai: adhesionIntervalObj): string => {
                    const when: number = ts(ai.nextTransmission);
                    const msg = ai.message.length > 60 ? ai.message.slice(0, 57) + "..." : ai.message;

                    return [
                        `N°**#${ai.id}** — ${msg}`,
                        `• Utilisateur à envoyer : ${formatUser(ai)}`,
                        `• Role à envoyer : ${formatRole(ai)}`,
                        `• Salon à envoyer : ${formatChannel(ai)}`,
                        `• Intervalle: **${ai.interval_days}j**`,
                        `• Prochain envoi: <t:${when}:F> (**<t:${when}:R>**)`,
                    ].join("\n");
                })
                .join("\n\n");

    return {
        embed: new EmbedBuilder()
            .setTitle("Rappels Programmés")
            .setDescription(desc)
            .setFooter({ text: `Page ${p + 1}/${totalPages} • ${items.length} rappel(s)` }),
        page: p,
        totalPages,
    };
}

/**
 * Envoie le message paginé et gère les interactions de navigation.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 * @param items Liste complète des rappels à paginer.
 */
async function sendInteractiveMsg(
    client: Client,
    interaction: ChatInputCommandInteraction,
    items: adhesionIntervalObj[]
): Promise<void> {
    const pageSize = 5;
    let page: number = 0;

    const mkRow = (p: number, total: number) =>
        new ActionRowBuilder<ButtonBuilder>().addComponents(
            new ButtonBuilder()
                .setCustomId("ai_prev")
                .setLabel("◀")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(p <= 0),
            new ButtonBuilder()
                .setCustomId("ai_next")
                .setLabel("▶")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(p >= total - 1),
            new ButtonBuilder()
                .setCustomId("ai_close")
                .setLabel("Fermer")
                .setStyle(ButtonStyle.Danger)
        );

    const first = buildEmbedPage(items, page, pageSize);
    const response = await interaction.reply({
        embeds: [first.embed],
        components: [mkRow(first.page, first.totalPages)],
        flags: MessageFlags.Ephemeral,
        withResponse: true,
    });

    if (!response.resource || !response.resource.message) {
        await sendLog(client, "Echec de récupération du message de liste de rappels");
        return;
    }

    const msg: Message<boolean> = response.resource.message;

    const collector = msg.createMessageComponentCollector({
        time: 2 * 60_000,
        filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on("collect", async (i) => {
        if (i.customId === "ai_close") {
            collector.stop("closed");
            await i.update({ components: [] });
            return;
        }

        if (i.customId === "ai_prev") page--;
        if (i.customId === "ai_next") page++;

        const built = buildEmbedPage(items, page, pageSize);
        page = built.page;

        await i.update({
            embeds: [built.embed],
            components: [mkRow(built.page, built.totalPages)],
        });
    });

    collector.on("end", async () => {
        // désactive les boutons à la fin
        try {
            const built = buildEmbedPage(items, page, pageSize);
            await interaction.editReply({
                embeds: [built.embed],
                components: [mkRow(0, 1).setComponents()], // vide = plus de boutons
            });
        } catch {}
    });
}

/**
 * Affiche la configuration des adhésions avec pagination interactive.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 */
async function displaySetupAdhesion(client: Client,
                                    interaction: ChatInputCommandInteraction): Promise<void> {
    console.log("Ouille");
    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get("AdhesionInterval", ["*"], undefined);
    if (result.length == 0) {
        await safeReply(interaction, "Pas de rappel paramétré !")
        return;
    }
    const ids = result as adhesionIntervalIds[];
    const intervals: adhesionIntervalObj[] = [];
    for (const intervalID of ids)
    {
        const interval: adhesionIntervalObj | null = await fetchTargets(client, bdd, intervalID);
        if (interval)
        {
            intervals.push(interval);
        }
    }
    await sendInteractiveMsg(client, interaction, intervals);
}

export { displaySetupAdhesion };
