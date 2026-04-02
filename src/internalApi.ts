import express, { type Request, type Response, type NextFunction } from "express";
import type { Client } from "discord.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { sendLog } from "@/safe/sendLog.js";

function authorize(req: Request, res: Response, next: NextFunction): void {
  const expectedToken = process.env.INTERNAL_API_TOKEN;
  if (!expectedToken) {
    next();
    return;
  }

  const providedToken = req.header("x-internal-token");
  if (providedToken !== expectedToken) {
    res.status(401).json({ error: "UNAUTHORIZED" });
    return;
  }

  next();
}

export function startInternalApi(client: Client) {
  const app = express();
  app.use(express.json());
  app.use("/internal", authorize);

  app.get("/internal/stats", async (_req: Request, res: Response) => {
    try {
      const bdd = await getBddInstance();

      const affiliatedServers = (await bdd.get(
        "ChannelPartner",
        ["COUNT(DISTINCT id_guild) AS total"],
        {},
        { query: "1 = 1", values: [] },
      )) as { total: number }[];

      const affiliatedChannels = (await bdd.get(
        "ChannelPartner",
        ["COUNT(*) AS total"],
        {},
        { query: "1 = 1", values: [] },
      )) as { total: number }[];

      const messagesLast30Days = (await bdd.get(
        "OGMsg",
        ["COUNT(*) AS total"],
        {},
        { query: "date >= datetime('now', '-30 day')", values: [] },
      )) as { total: number }[];

      const relayedMessagesLast30Days = (await bdd.get(
        "DPMsg",
        ["COUNT(*) AS total"],
        {},
        { query: "date >= datetime('now', '-30 day')", values: [] },
      )) as { total: number }[];

      const uniqueUsersLast30Days = (await bdd.get(
        "OGMsg",
        ["COUNT(DISTINCT id_author) AS total"],
        {},
        { query: "date >= datetime('now', '-30 day')", values: [] },
      )) as { total: number }[];

      res.json({
        affiliatedServers: Number(affiliatedServers[0]?.total ?? 0),
        affiliatedChannels: Number(affiliatedChannels[0]?.total ?? 0),
        messagesLast30Days: Number(messagesLast30Days[0]?.total ?? 0),
        relayedMessagesLast30Days: Number(relayedMessagesLast30Days[0]?.total ?? 0),
        uniqueUsersLast30Days: Number(uniqueUsersLast30Days[0]?.total ?? 0),
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "INTERNAL_STATS_ERROR" });
    }
  });

  app.post("/internal/auth/send-code", async (req: Request, res: Response) => {
    const discordId = String(req.body?.discordId || "").trim();
    const code = String(req.body?.code || "").trim();

    if (!/^\d{5,32}$/.test(discordId) || !/^\d{6}$/.test(code)) {
      res.status(400).json({ error: "INVALID_PAYLOAD" });
      return;
    }

    try {
      const user = await client.users.fetch(discordId);
      await user.send(`BlueGenji Arena - Code de connexion: **${code}** (valide 10 minutes).`);
      res.json({ success: true });
    } catch (error) {
      await sendLog(client, `Failed to send auth code to user ${discordId}: ${(error as Error).message}`);
      res.status(500).json({ error: "DISCORD_DM_FAILED" });
    }
  });

  app.post("/internal/log", async (req: Request, res: Response) => {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ error: "MISSING_MESSAGE" });
      return;
    }

    await sendLog(client, `[AppBlueGenji] ${message}`);
    res.json({ success: true });
  });

  const port = Number(process.env.INTERNAL_API_PORT || 4400);
  const host = process.env.INTERNAL_API_HOST || "127.0.0.1";

  const server = app.listen(port, host, () => {
    console.log(`Internal API listening on http://${host}:${port}`);
  });

  return server;
}
