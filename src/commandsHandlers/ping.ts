import type { Client, ChatInputCommandInteraction } from "discord.js";
import { safeReply } from "@/safe/safeReply.js";
import { sendLog } from "@/safe/sendLog.js";

export async function ping(client: Client, interaction: ChatInputCommandInteraction): Promise<void> {
  try {
    const latency = Math.max(0, Math.round(client.ws.ping));
    await safeReply(interaction, `Pong ! Latence WebSocket : ${latency} ms.`, true, false);
  } catch (err) {
    await sendLog(client, `ping handler error: ${(err as Error).message}`);
  }
}
