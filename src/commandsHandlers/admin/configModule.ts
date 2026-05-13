import { PermissionFlagsBits } from "discord.js";
import type { Client, ChatInputCommandInteraction, GuildMember } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { isValidModule, isModuleEnabled, setModuleEnabled } from "@/modules/moduleGuard.js";

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
