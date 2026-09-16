import {ChatInputCommandInteraction, Client, Message, MessageFlags} from "discord.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {safeReply} from "@/safe/safeReply.js";
import {adhesionIntervalIds} from "@/adhesion/types.js"

import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} from "discord.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * Formate une cible pour l'embed, à partir de son **identifiant brut**.
 *
 * Aucune résolution n'est demandée à Discord : une mention `<@id>` est rendue
 * par le client du lecteur, pas par le bot. C'est délibéré — l'affichage
 * passait auparavant par `fetchTargets`, qui **supprime** l'intervalle quand une
 * cible ne répond pas. Une commande de lecture ne doit rien effacer, et surtout
 * pas la ligne qu'on vient d'ouvrir la commande pour lire.
 *
 * @param id Identifiant Discord stocké en base, ou `null` si la cible n'existe pas.
 * @param prefix `@` pour un membre, `@&` pour un rôle, `#` pour un salon.
 */
function formatTarget(id: string | null, prefix: "@" | "@&" | "#"): string {
    return id ? `<${prefix}${id}>` : "—";
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
 * Décrit la cadence d'un rappel.
 *
 * `iteration` vaut `-1` pour un rappel **sans fin** (`/get-adhesion`), et `n > 0`
 * pour un rappel qui s'arrêtera après `n` envois — c'est la forme que prend
 * l'avis de péremption posé par `/adhesion-valide`, avec `n = 1`.
 *
 * Les seconds étaient **masqués** de cette liste (`items.filter(i => i.iteration
 * == -1)`). Ils continuaient pourtant d'être envoyés, et comme `/delete-rappel-
 * adhesion` réclame un identifiant que seule cette commande donne, ils étaient
 * aussi **impossibles à annuler**. On les montre donc, en disant ce qu'ils sont.
 */
function formatCadence(ai: adhesionIntervalIds): string {
    if (ai.iteration === -1) {
        return `Tous les **${ai.interval_days}j**, sans fin`;
    }
    const envois = ai.iteration === 1 ? "1 envoi restant" : `${ai.iteration} envois restants`;
    return `Péremption — **${envois}**`;
}

/**
 * Construit une page d'embed pour la pagination des configurations d'adhésion.
 *
 * La pagination se calcule sur **la liste effectivement affichée**. Elle
 * comptait auparavant les pages et le total sur `items` entier tout en découpant
 * une liste filtrée : avec douze rappels dont trois visibles, la commande
 * annonçait trois pages, n'en remplissait qu'une, et affichait
 * « Aucun rappel programmé » sur les suivantes.
 *
 * @param items Liste complète des rappels à paginer.
 * @param page Index de page demandé (base 0).
 * @param pageSize Nombre d'éléments à afficher par page.
 * @returns Objet de pagination contenant `embed`, `page` et `totalPages`, avec page bornée sur l'intervalle valide.
 */
function buildEmbedPage(items: adhesionIntervalIds[], page: number, pageSize: number) {
    const totalPages: number = Math.max(1, Math.ceil(items.length / pageSize));
    const p: number = Math.min(Math.max(page, 0), totalPages - 1);
    const slice: adhesionIntervalIds[] = items.slice(p * pageSize, p * pageSize + pageSize);

    const desc: string =
        slice.length === 0
            ? "Aucun rappel programmé."
            : slice
                .map((ai: adhesionIntervalIds): string => {
                    const when: number = ts(new Date(ai.nextTransmission));
                    const rawMsg: string = ai.message ?? "";
                    // Un rappel peut n'avoir aucun message : la ligne n°4 de la
                    // base de production en était un. Le dire vaut mieux que
                    // laisser un titre vide, qui se lit comme un bug d'affichage.
                    const msg = rawMsg.length === 0
                        ? "_(sans message)_"
                        : rawMsg.length > 60 ? rawMsg.slice(0, 57) + "..." : rawMsg;
                    const sansCible =
                        ai.member_id === null && ai.role_id === null && ai.channel_id === null;

                    return [
                        `N°**#${ai.id}** — ${msg}`,
                        `• Utilisateur à envoyer : ${formatTarget(ai.member_id, "@")}`,
                        `• Role à envoyer : ${formatTarget(ai.role_id, "@&")}`,
                        `• Salon à envoyer : ${formatTarget(ai.channel_id, "#")}`,
                        `• Cadence : ${formatCadence(ai)}`,
                        `• Prochain envoi: <t:${when}:F> (**<t:${when}:R>**)`,
                        ...(sansCible ? ["⚠️ **Aucune cible** — le rappel part à son auteur."] : []),
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
    items: adhesionIntervalIds[]
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
    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get("AdhesionInterval", ["*"], undefined);
    if (result.length == 0) {
        await safeReply(interaction, "Pas de rappel paramétré !")
        return;
    }
    // Les lignes partent à l'affichage **telles qu'elles sont en base**, sans
    // passer par `fetchTargets`. Celui-ci résout les identifiants auprès de
    // Discord et, à la moindre résolution manquée, **supprime** l'intervalle —
    // une panne réseau ou une limite de débit suffisait donc à effacer
    // définitivement une programmation, depuis une commande de simple lecture.
    // L'affichage n'a de toute façon besoin d'aucun objet Discord : une mention
    // `<@id>` est rendue par le client du lecteur.
    const intervals = result as adhesionIntervalIds[];
    intervals.sort((left, right) => left.id - right.id);
    await sendInteractiveMsg(client, interaction, intervals);
}

// `buildEmbedPage` et `formatCadence` sont pures : exportées pour être
// éprouvées directement, la pagination et le filtrage étant précisément ce qui
// a fait disparaître des rappels de la liste.
export { displaySetupAdhesion, buildEmbedPage, formatCadence };
