import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";
import { formatSiteVisitStats, readSiteVisitStats } from "@/siteVisits/siteVisits.js";

/**
 * Commande `/stats-site` : frequentation du site BlueGenji (visites totales et
 * visiteurs uniques).
 *
 * Lit l'instantane pousse par l'app web sur l'API interne, sans appeler le site :
 * la commande repond donc meme si le site est momentanement injoignable, en
 * indiquant l'anciennete de la derniere mesure.
 */
export async function statsSite(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const stats = await readSiteVisitStats();
    await safeReply(interaction, formatSiteVisitStats(stats), true, false);
  } catch (err) {
    await sendLog(client, `statsSite handler error: ${(err as Error).message}`);
    await safeReply(interaction, "Impossible de lire la frequentation du site pour le moment.", true, false);
  }
}
