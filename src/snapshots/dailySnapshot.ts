import type { Client } from "discord.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { sendLog } from "@/safe/sendLog.js";

export async function recordDailySnapshot(client: Client): Promise<void> {
  try {
    const bdd = await getBddInstance();
    const today = new Date().toISOString().slice(0, 10);
    const channelsRows = (await bdd.get(
      "ChannelPartner",
      ["COUNT(*) AS total"],
      {},
      {
        query: "1 = 1",
        values: [],
      }
    )) as { total: number }[];
    const guildsRows = (await bdd.get(
      "ChannelPartner",
      ["COUNT(DISTINCT id_guild) AS total"],
      {},
      {
        query: "1 = 1",
        values: [],
      }
    )) as { total: number }[];
    const messagesRows = (await bdd.get(
      "OGMsg",
      ["COUNT(*) AS total"],
      {},
      {
        query: "date >= datetime('now', '-1 day')",
        values: [],
      }
    )) as { total: number }[];
    const relaysRows = (await bdd.get(
      "DPMsg",
      ["COUNT(*) AS total"],
      {},
      {
        query: "date >= datetime('now', '-1 day')",
        values: [],
      }
    )) as { total: number }[];
    const serversCount =
      client.guilds.cache.size || Number(guildsRows[0]?.total ?? 0);
    await bdd.raw(
      "INSERT INTO DailySnapshot (date, servers_count, channels_count, messages_count, relays_count) VALUES (?, ?, ?, ?, ?) ON CONFLICT(date) DO UPDATE SET servers_count = excluded.servers_count, channels_count = excluded.channels_count, messages_count = excluded.messages_count, relays_count = excluded.relays_count",
      [
        today,
        serversCount,
        Number(channelsRows[0]?.total ?? 0),
        Number(messagesRows[0]?.total ?? 0),
        Number(relaysRows[0]?.total ?? 0),
      ]
    );
  } catch (err) {
    await sendLog(
      client,
      `recordDailySnapshot error: ${(err as Error).message}`
    );
  }
}

export async function getSnapshotsBetween(
  daysAgoStart: number,
  daysAgoEnd: number
): Promise<
  Array<{
    date: string;
    servers_count: number;
    channels_count: number;
    messages_count: number;
    relays_count: number;
  }>
> {
  const bdd = await getBddInstance();
  return bdd.raw(
    "SELECT date, servers_count, channels_count, messages_count, relays_count FROM DailySnapshot WHERE date >= date('now', ?) AND date <= date('now', ?) ORDER BY date ASC",
    [`-${daysAgoStart} day`, `-${daysAgoEnd} day`]
  );
}
