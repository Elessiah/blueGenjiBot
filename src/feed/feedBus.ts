import { EventEmitter } from "events";
import type { Client } from "discord.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { sendLog } from "@/safe/sendLog.js";

export type FeedEventType = "relay" | "scrim" | "recr" | "auth" | "warn";
export interface FeedEventRow {
  id: number;
  ts: string;
  type: FeedEventType;
  source: string | null;
  target: string | null;
  summary: string;
}

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

export async function recordEvent(
  client: Client | null,
  type: FeedEventType,
  summary: string,
  source?: string | null,
  target?: string | null
): Promise<void> {
  try {
    const bdd = await getBddInstance();
    await bdd.set(
      "FeedEvent",
      ["type", "source", "target", "summary"],
      [type, source ?? null, target ?? null, summary]
    );
    const rows = await bdd.raw<FeedEventRow>(
      "SELECT id, ts, type, source, target, summary FROM FeedEvent ORDER BY id DESC LIMIT 1",
      []
    );
    if (rows.length > 0) {
      emitter.emit("event", rows[0]);
    }
  } catch (err) {
    if (client) {
      await sendLog(
        client,
        `recordEvent error: ${(err as Error).message}`
      );
    }
  }
}

export async function getBacklog(
  limit: number = 13,
  sinceId?: number
): Promise<FeedEventRow[]> {
  const bdd = await getBddInstance();
  if (typeof sinceId === "number" && !Number.isNaN(sinceId)) {
    return bdd.raw<FeedEventRow>(
      "SELECT id, ts, type, source, target, summary FROM FeedEvent WHERE id > ? ORDER BY id ASC LIMIT ?",
      [sinceId, limit]
    );
  }
  const rows = await bdd.raw<FeedEventRow>(
    "SELECT id, ts, type, source, target, summary FROM FeedEvent ORDER BY id DESC LIMIT ?",
    [limit]
  );
  return rows.reverse();
}

export function subscribe(
  handler: (event: FeedEventRow) => void
): () => void {
  emitter.on("event", handler);
  return () => {
    emitter.off("event", handler);
  };
}
