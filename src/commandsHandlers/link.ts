import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { recordEvent } from "@/feed/feedBus.js";

export async function link(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");
    const bdd = await getBddInstance();
    await bdd.raw("INSERT INTO UserLink (id_user, code, expires_at, linked_at) VALUES (?, ?, ?, NULL) ON CONFLICT(id_user) DO UPDATE SET code = excluded.code, expires_at = excluded.expires_at, linked_at = NULL", [interaction.user.id, code, expiresAt]);
    try {
      await interaction.user.send(`BlueGenji Arena - Code de liaison : **${code}** (valide 10 minutes). Entrez-le sur le site pour lier votre compte Discord.`);
      await safeReply(interaction, "Code envoye en message prive. Verifiez vos DM.", true, false);
      await recordEvent(client, "auth", `Code /link envoye a <@${interaction.user.id}>`, null, interaction.user.id);
    } catch {
      await safeReply(interaction, "Impossible d'envoyer le DM. Activez les messages prives du serveur dans vos parametres Discord.", true, false);
    }
  } catch (err) {
    await sendLog(client, `link handler error: ${(err as Error).message}`);
  }
}
