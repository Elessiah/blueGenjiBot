import {safeReply} from "../../safe/safeReply.js";
import {checkPermissions} from "../../check/checkPermissions.js";
import {Bdd, getBddInstance} from "../../bdd/Bdd.js";
import type {ChatInputCommandInteraction, Client, Guild} from "discord.js";
import {Ban} from "../../bdd/types.js";
import {deleteBanMessages} from "../../privacy/staffLogRetention.js";
import {forgetBanVerdict} from "../../check/checkBan.js";

/**
 * Retire un utilisateur de la liste de bannissement.
 * @param client Client Discord utilisé pour les appels API.
 * @param interaction Interaction utilisateur en cours.
 * @returns `false` si préconditions/permissions/paramètres invalides; `true` quand la commande est traitée (ID inconnu ou débannissement effectué).
 */
async function unban(client: Client,
                     interaction: ChatInputCommandInteraction): Promise<boolean> {
    const guild: Guild | null = interaction.guild;
    if (!guild) {
        await safeReply(interaction, "Internal error. The guild was not found with the interaction. Please try again !");
        return false;
    }
    if (guild.id !== process.env.SERV_RIVALS && guild.id !== process.env.SERV_GENJI && guild.memberCount < 50) {
        await safeReply(interaction, "Your server doesn't have enough members to unban users.\n" +
            "A minimum of 50 members is required.\n" +
            "If necessary, please contact 'Elessiah' or the administrators of a server that meets the requirements to take appropriate measures.\n");
        return false;
    }
    if (!(await checkPermissions(interaction))) {
        await safeReply(interaction, "You don't have permission to unban users.\n" +
            "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n");
        return false;
    }
    const bdd: Bdd = await getBddInstance();
    const target: string | null = interaction.options.getString("id_ban");
    if (!target) {
        await safeReply(interaction, "Parameter 'id_ban' was not found ! Please try again !");
        return false;
    }
    const user: Ban[] = await bdd.get("Ban", ["*"], {}, {query: "id_user = ?", values: [target]}) as Ban[];
    if (user.length === 0) {
        await safeReply(interaction, "Unknown ID ban !");
    } else {
        // La ligne effacée est rendue par la même instruction : un avis remis
        // pendant la levée y figure déjà (sinon, il se voit sans ligne et s'efface lui-même).
        const removed = await bdd.raw<Ban>("DELETE FROM Ban WHERE id_user = ? RETURNING *", [target]);
        if (removed.length === 0) {
            // Levée par un autre modérateur entre-temps : tout est déjà fait.
            await safeReply(interaction, "Unknown ID ban !");
            return true;
        }
        // Le relais garde une minute le verdict « exclu » : la levée vaut sur-le-champ.
        forgetBanVerdict(target);
        // Réponse d'abord : Discord n'attend que 3 s, et les suppressions
        // ci-dessous font plusieurs appels.
        await safeReply(interaction, "User successfully unbanned.");
        // Le motif et l'avis de l'exclusion n'ont plus d'objet : effacés du
        // salon du staff et des messages privés du propriétaire. Au mieux — ce
        // qui resterait n'est plus protégé de la purge d'un an du journal.
        for (const ban of removed) {
            await deleteBanMessages(client, ban);
        }
    }
    return true;
}

export {unban};
