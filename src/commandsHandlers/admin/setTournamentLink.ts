/**
 * Handler de `/set-tournoi-lien` : remplace un lien affiché par `/tournoi`,
 * ou le rend à sa valeur par défaut quand `url` est omis.
 *
 * Réservé aux admins BlueGenji : la commande n'est enregistrée que sur les
 * serveurs BlueGenji (`fillBlueCommands`), et le handler le revérifie avant
 * `checkPermissions` (propriétaire, président, rôle admin du bot ou
 * administrateur du serveur) — un administrateur d'un serveur partenaire ne
 * doit pas pouvoir changer un lien publié sur tout le réseau.
 */

import type { ChatInputCommandInteraction, Client } from "discord.js";

import { getBddInstance } from "../../bdd/Bdd.js";
import { checkPermissions } from "../../check/checkPermissions.js";
import { safeReply } from "../../safe/safeReply.js";
import { sendLog } from "../../safe/sendLog.js";
import {
    DEFAULT_TOURNAMENT_LINKS,
    MAX_TOURNAMENT_LINK_LENGTH,
    TOURNAMENT_LINK_LABELS,
    isTournamentLinkKind,
    normalizeTournamentLink,
} from "../../tournament/tournamentLinks.js";

/**
 * @param guildId Serveur où la commande est lancée.
 * @returns `true` pour un serveur BlueGenji (`SERV_GENJI`, `SERV_RIVALS`).
 */
export function isBlueGenjiGuild(guildId: string | null): boolean {
    const { SERV_GENJI, SERV_RIVALS } = process.env;
    return !!guildId && (guildId === SERV_GENJI || guildId === SERV_RIVALS);
}

/**
 * @param client Client Discord, utilisé pour journaliser.
 * @param interaction Interaction `/set-tournoi-lien` (option `lien` requise, `url` facultative).
 */
export async function setTournamentLink(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
    try {
        if (!isBlueGenjiGuild(interaction.guildId) || !(await checkPermissions(interaction))) {
            await safeReply(interaction, "❌ Commande réservée aux admins BlueGenji.");
            return;
        }
        const kind = interaction.options.getString("lien", true);
        if (!isTournamentLinkKind(kind)) {
            await safeReply(interaction, "❌ Lien inconnu.");
            return;
        }
        const raw = interaction.options.getString("url");
        const url = raw === null ? null : normalizeTournamentLink(raw);
        if (raw !== null && url === null) {
            await safeReply(interaction, `❌ Lien invalide : une adresse \`https://\` complète, sans espace ni caractère \`< > ( )\` ni \`@everyone\` / \`@here\`, de ${MAX_TOURNAMENT_LINK_LENGTH} caractères au plus.`);
            return;
        }
        const result = await (await getBddInstance()).setTournamentLink(kind, url);
        if (!result.success) {
            await safeReply(interaction, "❌ Échec de l'enregistrement du lien. Réessayez plus tard.");
            await sendLog(client, `setTournamentLink error (${kind}): ${result.message}`);
            return;
        }
        const label = TOURNAMENT_LINK_LABELS[kind];
        const shown = url ?? DEFAULT_TOURNAMENT_LINKS[kind];
        await safeReply(interaction, url === null
            ? `✅ ${label} : lien par défaut rétabli (<${shown}>).`
            : `✅ ${label} : nouveau lien enregistré (<${shown}>).`);
        await sendLog(client, `/set-tournoi-lien: ${kind} ${url === null ? "rétabli par défaut" : "modifié"} par ${interaction.user.id}`);
    } catch (err) {
        await sendLog(client, `setTournamentLink handler error: ${(err as Error).message}`);
        await safeReply(interaction, "❌ Erreur inattendue, voir le journal du bot.");
    }
}
