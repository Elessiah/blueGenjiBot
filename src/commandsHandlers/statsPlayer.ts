import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { getBddInstance } from "@/bdd/Bdd.js";

export async function statsPlayer(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const targetUser = interaction.options.getUser("joueur", false) ?? interaction.user;
    const bdd = await getBddInstance();
    const msgRows = await bdd.get("OGMsg", ["COUNT(*) AS total"], {}, { query: "id_author = ? AND date >= datetime('now', '-30 day')", values: [targetUser.id] }) as { total: number }[];
    const scrimRows = await bdd.get("Scrim", ["COUNT(*) AS total"], {}, { query: "id_author = ? AND date >= datetime('now', '-30 day')", values: [targetUser.id] }) as { total: number }[];
    const recruteRows = await bdd.get("Recrute", ["COUNT(*) AS total"], {}, { query: "id_author = ? AND date >= datetime('now', '-30 day')", values: [targetUser.id] }) as { total: number }[];
    const msg = `Stats 30j de ${targetUser.username}\n- Messages partenaires : ${Number(msgRows[0]?.total ?? 0)}\n- Scrims proposes : ${Number(scrimRows[0]?.total ?? 0)}\n- Recherches : ${Number(recruteRows[0]?.total ?? 0)}`;
    await safeReply(interaction, msg, true, false);
  } catch (err) {
    await sendLog(client, `statsPlayer handler error: ${(err as Error).message}`);
  }
}
