/**
 * Handler de `/set-bot-admin` : designe le role qui peut administrer le bot sur ce serveur.
 *
 * Insere ou met a jour selon qu'une ligne existe deja pour ce serveur, plutot
 * qu'un simple upsert SQL : `Bdd` n'exposait pas cette primitive au moment de
 * l'ecriture, d'ou le `get` prealable qui decide entre `set` et `update`.
 */

import {ChatInputCommandInteraction, Client, Role} from "discord.js";
import {safeReply} from "@/safe/safeReply.js";
import {checkPermissions} from "@/check/checkPermissions.js";
import {Bdd, getBddInstance} from "@/bdd/Bdd.js";
import {status} from "@/types.js";
import {sendLog} from "@/safe/sendLog.js";

/**
 * @param client Client Discord, utilise pour journaliser un echec d'ecriture en base.
 * @param interaction Interaction `/set-bot-admin` (option `role` requise) ; doit venir d'un serveur ou l'auteur a les permissions requises par `checkPermissions`.
 */
async function setBotAdminRole(client: Client,
                               interaction: ChatInputCommandInteraction): Promise<void>  {
    if (!interaction.guild) {
        await safeReply(interaction, "You must be on a partner server to setup an admin role.");
        return;
    }
    if (!(await checkPermissions(interaction))) {
        await safeReply(interaction, "You must be on a partner server to setup an admin role.");
        return;
    }
    const role: Role = interaction.options.getRole("role", true) as Role;
    const guildID: string = interaction.guild.id;
    const bdd: Bdd = await getBddInstance();
    const result: unknown[] = await bdd.get(
        "RoleAdmin",
        ["guild_id"],
        undefined,
        {query: "guild_id = ?", values: [guildID]});
    let status: status;
    if (result.length == 0) {
        status = await bdd.set("RoleAdmin", ["guild_id", "role_id"], [guildID, role.id]);
    } else {
        try {
            await bdd.update("RoleAdmin", {"role_id": role.id}, {"guild_id": guildID});
            status = {success: true, message: ""};
        } catch (e) {
            status = {success: false, message: "Update setBotAdminRole : " + (e as Error).message};
        }
    }
    if (!status.success) {
        await safeReply(interaction, "Failed to set the new admin role. Please try again.");
        await sendLog(client, status.message);
    } else {
        await safeReply(interaction, "Admin role set successfully !");
    }
}

export {setBotAdminRole};