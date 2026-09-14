/**
 * Handler de `/ping` : renvoie la latence WebSocket du bot vers Discord.
 *
 * Sert de sonde manuelle rapide quand un utilisateur signale un bot lent ou
 * muet, sans avoir a demander l'acces au canal de logs de supervision.
 */

import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";

/**
 * @param client Client Discord, dont on lit la latence WebSocket (`client.ws.ping`).
 * @param interaction Interaction `/ping` a laquelle repondre.
 */
export async function ping(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const latency = Math.max(0, Math.round(client.ws.ping));
    await safeReply(interaction, `Pong ! Latence WebSocket : ${latency} ms.`, true, false);
  } catch (err) {
    await sendLog(client, `ping handler error: ${(err as Error).message}`);
  }
}
