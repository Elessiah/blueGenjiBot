import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { recordEvent } from "@/feed/feedBus.js";
import { isModuleEnabled } from "@/modules/moduleGuard.js";

export async function recrute(client: Client, interaction: ChatInputCommandInteraction, guildId: string | null): Promise<void> {
  try {
    const role = interaction.options.getString("role", true);
    if (guildId && !(await isModuleEnabled(guildId, "recrutement"))) {
      await safeReply(interaction, "Le module Recrutement est desactive sur ce serveur.", true, false);
      return;
    }
    const bdd = await getBddInstance();
    const status = await bdd.set("Recrute", ["id_author", "role", "id_guild"], [interaction.user.id, role, guildId]);
    if (!status.success) {
      await safeReply(interaction, "Erreur lors de l'enregistrement de la recherche.", true, false);
      return;
    }
    await recordEvent(client, "recr", `Recherche ${role} par <@${interaction.user.id}>`, interaction.guild?.name ?? null, null);
    await safeReply(interaction, `Recherche publiee : **${role}**.`, false, false);
  } catch (err) {
    await sendLog(client, `recrute handler error: ${(err as Error).message}`);
  }
}
