import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { recordEvent } from "@/feed/feedBus.js";
import { isModuleEnabled } from "@/modules/moduleGuard.js";

export async function scrim(client: Client, interaction: ChatInputCommandInteraction, guildId: string | null): Promise<void> {
  try {
    const jeu = interaction.options.getString("jeu", true);
    const niveau = interaction.options.getString("niveau", true);
    if (guildId && !(await isModuleEnabled(guildId, "scrims"))) {
      await safeReply(interaction, "Le module Scrims est desactive sur ce serveur.", true, false);
      return;
    }
    const bdd = await getBddInstance();
    const status = await bdd.set("Scrim", ["id_author", "game", "level", "id_guild"], [interaction.user.id, jeu, niveau, guildId]);
    if (!status.success) {
      await safeReply(interaction, "Erreur lors de l'enregistrement du scrim.", true, false);
      return;
    }
    await recordEvent(client, "scrim", `Scrim ${jeu} niveau ${niveau} par <@${interaction.user.id}>`, interaction.guild?.name ?? null, null);
    await safeReply(interaction, `Recherche de scrim publiee : **${jeu}** (${niveau}).`, false, false);
  } catch (err) {
    await sendLog(client, `scrim handler error: ${(err as Error).message}`);
  }
}
