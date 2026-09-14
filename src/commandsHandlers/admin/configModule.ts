/**
 * Handler de `/config` : bascule un module (annonces, scrims, recrutement, notifications, stats) pour le serveur courant.
 *
 * Reserve aux administrateurs Discord du serveur, pas au role admin du bot :
 * activer ou desactiver un module change ce que les membres peuvent faire
 * (ecrire en base via `/scrim`, `/recrute`, ...), une decision qui reste au
 * niveau de la permission Discord native plutot que d'une delegation du bot.
 * Le module `oauth` (liaison compte) est expressement exclu : il reste
 * toujours actif, la liaison de compte n'est pas une fonctionnalite qu'un
 * serveur peut couper pour ses membres.
 */

import { PermissionFlagsBits } from "discord.js";
import type { Client, ChatInputCommandInteraction, GuildMember } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { isValidModule, isModuleEnabled, setModuleEnabled } from "@/modules/moduleGuard.js";

/**
 * @param client Client Discord, utilise pour journaliser le changement.
 * @param interaction Interaction `/config` (option `module` requise).
 * @param guildId Serveur cible ; `null` en DM, la commande refuse alors de s'executer.
 */
export async function configModule(client: Client, interaction: ChatInputCommandInteraction, guildId: string | null): Promise<void> {
  try {
    if (!guildId) {
      await safeReply(interaction, "Commande utilisable uniquement sur un serveur.", true, false);
      return;
    }
    const member = interaction.member as GuildMember | null;
    if (!member || !member.permissions.has(PermissionFlagsBits.Administrator)) {
      await safeReply(interaction, "Cette commande necessite la permission Administrateur.", true, false);
      return;
    }
    const moduleKey = interaction.options.getString("module", true);
    if (!isValidModule(moduleKey)) {
      await safeReply(interaction, "Module invalide.", true, false);
      return;
    }
    if (moduleKey === "oauth") {
      await safeReply(interaction, "Le module OAuth est toujours actif et ne peut pas etre desactive.", true, false);
      return;
    }
    const current = await isModuleEnabled(guildId, moduleKey);
    const next = !current;
    await setModuleEnabled(guildId, moduleKey, next);
    await safeReply(interaction, `Module **${moduleKey}** ${next ? "active" : "desactive"}.`, true, false);
    await sendLog(client, `/config: ${moduleKey} -> ${next ? "on" : "off"} sur ${guildId}`);
  } catch (err) {
    await sendLog(client, `configModule handler error: ${(err as Error).message}`);
  }
}
