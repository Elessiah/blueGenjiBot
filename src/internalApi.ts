import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import type { Client } from "discord.js";
import { getBddInstance } from "@/bdd/Bdd.js";
import { sendLog } from "@/safe/sendLog.js";
import { recordEvent, getBacklog, subscribe } from "@/feed/feedBus.js";
import { getSnapshotsBetween } from "@/snapshots/dailySnapshot.js";
import { listModules, isValidModule, setModuleEnabled, MODULE_KEYS, type ModuleKey } from "@/modules/moduleGuard.js";
import { pctDelta, absDelta, deterministicColor } from "@/internalApi/helpers.js";

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

const STARTUP_TS = Date.now();

function readPackageInfo(): { version: string; buildHash: string; buildDate: string } {
  try {
    const pkgPath = path.resolve(process.cwd(), "package.json");
    const pkgRaw = fs.readFileSync(pkgPath, "utf8");
    const pkg = JSON.parse(pkgRaw) as { version?: string };
    const stat = fs.statSync(pkgPath);
    const version = pkg.version ?? "0.0.0";
    const buildHash = createHash("sha1").update(pkgRaw + stat.mtimeMs.toString()).digest("hex").slice(0, 7);
    return { version, buildHash, buildDate: new Date(stat.mtimeMs).toISOString() };
  } catch {
    return { version: "0.0.0", buildHash: "unknown", buildDate: new Date(0).toISOString() };
  }
}

const PKG_INFO = readPackageInfo();

async function getCpuPercent(): Promise<number> {
  const start = process.cpuUsage();
  const startTime = Date.now();
  await new Promise((r) => setTimeout(r, 100));
  const diff = process.cpuUsage(start);
  const elapsedMs = Date.now() - startTime;
  const totalCpuMs = (diff.user + diff.system) / 1000;
  const cpuCount = os.cpus().length || 1;
  return Math.min(100, Math.round((totalCpuMs / (elapsedMs * cpuCount)) * 100));
}

export function startInternalApi(client: Client) {
  const app = express();
  app.use(express.json());
  app.use("/internal", authorize);

  app.get("/internal/feed/stream", async (req: Request, res: Response) => {
    try {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const lastIdHeader = req.header("last-event-id");
      const sinceId = lastIdHeader ? Number(lastIdHeader) : undefined;
      const backlog = await getBacklog(13, Number.isFinite(sinceId) ? sinceId : undefined);
      for (const ev of backlog) {
        res.write(`id: ${ev.id}\n`);
        res.write(`event: feed\n`);
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }

      const unsubscribe = subscribe((ev) => {
        try {
          res.write(`id: ${ev.id}\n`);
          res.write(`event: feed\n`);
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        } catch { /* connection closed */ }
      });

      const heartbeat = setInterval(() => {
        try { res.write(`: heartbeat ${Date.now()}\n\n`); }
        catch { clearInterval(heartbeat); }
      }, 30000);

      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try { res.end(); } catch { /* noop */ }
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "INTERNAL_FEED_ERROR" });
    }
  });

  app.get("/internal/health", async (_req: Request, res: Response) => {
    const checks: Record<string, string | number> = {};
    let allOk = true;
    try {
      checks.discord = client.isReady() ? "ok" : "down";
      if (!client.isReady()) { allOk = false; }
      checks.latency = Math.max(0, Math.round(client.ws.ping));
      if ((checks.latency as number) > 1000) { allOk = false; }
    } catch { checks.discord = "error"; allOk = false; }
    try {
      const bdd = await getBddInstance();
      const probe = await bdd.get("Service", ["COUNT(*) AS total"], {}, { query: "1 = 1", values: [] }) as { total: number }[];
      checks.database = probe ? "ok" : "error";
    } catch { checks.database = "error"; allOk = false; }
    res.status(allOk ? 200 : 503).json({ status: allOk ? "healthy" : "unhealthy", checks });
  });

  app.get("/internal/invite", (_req: Request, res: Response) => {
    const clientId = process.env.CLIENT_ID ?? "";
    if (!clientId) {
      res.status(500).json({ error: "CLIENT_ID_NOT_CONFIGURED" });
      return;
    }
    const permissions = "1099511627776";
    const scopes = ["bot", "applications.commands"];
    const url = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=${permissions}&scope=${scopes.map(encodeURIComponent).join("%20")}`;
    res.json({ url, permissions, scopes });
  });

  app.get("/internal/status", async (_req: Request, res: Response) => {
    try {
      const uptimeMs = Date.now() - STARTUP_TS;
      const gatewayLatency = Math.max(0, Math.round(client.ws.ping));
      const shardSize = client.ws.shards.size || 1;
      const shardTotal = (client.shard?.count) ?? shardSize;
      const cpuUsage = await getCpuPercent();
      const ramUsage = Math.round(process.memoryUsage().rss / 1024 / 1024);
      const isReady = client.isReady();
      let status: "OPERATIONAL" | "DEGRADED" | "DOWN" = "OPERATIONAL";
      if (!isReady) {
        status = "DOWN";
      } else if (gatewayLatency >= 500 || cpuUsage >= 90) {
        status = "DEGRADED";
      }
      res.json({
        startupTs: STARTUP_TS,
        uptimeMs,
        version: PKG_INFO.version,
        buildHash: PKG_INFO.buildHash,
        buildDate: PKG_INFO.buildDate,
        gatewayLatency,
        shardCount: { active: shardSize, total: shardTotal },
        cpuUsage,
        ramUsage,
        status,
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "INTERNAL_STATUS_ERROR" });
    }
  });

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

  app.post("/internal/auth/resolve", async (req: Request, res: Response) => {
    const handle = String(req.body?.handle || "").trim();
    if (!handle) {
      res.status(400).json({ error: "INVALID_PAYLOAD" });
      return;
    }

    // ID numérique : renvoyé tel quel (option de repli côté app).
    if (/^\d{5,32}$/.test(handle)) {
      res.json({ discordId: handle, matchedBy: "id" });
      return;
    }

    // Tag : supporte "pseudo" (nouveau format unique) et legacy "pseudo#1234".
    let username = handle.replace(/^@/, "");
    let discriminator: string | null = null;
    const hashIdx = username.lastIndexOf("#");
    if (hashIdx > 0 && /^\d{4}$/.test(username.slice(hashIdx + 1))) {
      discriminator = username.slice(hashIdx + 1);
      username = username.slice(0, hashIdx);
    }
    const normalized = username.toLowerCase();

    try {
      for (const guild of client.guilds.cache.values()) {
        let members;
        try {
          members = await guild.members.fetch({ query: username, limit: 100 });
        } catch {
          continue; // guilde momentanément injoignable : on tente les suivantes.
        }

        // On matche uniquement le username (unique globalement) : globalName et
        // nickname ne le sont pas et résoudraient vers le mauvais compte.
        const match = members.find((m) => {
          const uname = m.user.username?.toLowerCase() ?? "";
          if (discriminator) {
            return uname === normalized && m.user.discriminator === discriminator;
          }
          return uname === normalized;
        });

        if (match) {
          res.json({ discordId: match.id, matchedBy: "tag" });
          return;
        }
      }

      res.status(404).json({ error: "DISCORD_USER_NOT_FOUND" });
    } catch (error) {
      await sendLog(client, `Failed to resolve discord handle "${handle}": ${(error as Error).message}`);
      res.status(500).json({ error: "INTERNAL_RESOLVE_ERROR" });
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
      await recordEvent(client, 'auth', `Code DM envoye a ${discordId}`, null, discordId);
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

  app.get("/internal/kpis", async (_req: Request, res: Response) => {
    try {
      const bdd = await getBddInstance();

      const serversNow = client.guilds.cache.size;
      const channelsNowRows = (await bdd.get("ChannelPartner", ["COUNT(*) AS total"], {}, { query: "1 = 1", values: [] })) as { total: number }[];
      const channelsNow = Number(channelsNowRows[0]?.total ?? 0);

      const msgCurrRows = (await bdd.get("OGMsg", ["COUNT(*) AS total"], {}, { query: "date >= datetime('now', '-30 day')", values: [] })) as { total: number }[];
      const msgPrevRows = (await bdd.get("OGMsg", ["COUNT(*) AS total"], {}, { query: "date >= datetime('now', '-60 day') AND date < datetime('now', '-30 day')", values: [] })) as { total: number }[];
      const messagesNow = Number(msgCurrRows[0]?.total ?? 0);
      const messagesPrev = Number(msgPrevRows[0]?.total ?? 0);

      const relayCurrRows = (await bdd.get("DPMsg", ["COUNT(*) AS total"], {}, { query: "date >= datetime('now', '-30 day')", values: [] })) as { total: number }[];
      const relayPrevRows = (await bdd.get("DPMsg", ["COUNT(*) AS total"], {}, { query: "date >= datetime('now', '-60 day') AND date < datetime('now', '-30 day')", values: [] })) as { total: number }[];
      const relaysNow = Number(relayCurrRows[0]?.total ?? 0);
      const relaysPrev = Number(relayPrevRows[0]?.total ?? 0);

      const snap30 = await getSnapshotsBetween(31, 29);
      const serversPrev = snap30.length > 0 ? snap30[0].servers_count : serversNow;
      const channelsPrev = snap30.length > 0 ? snap30[0].channels_count : channelsNow;

      const buildSeries = async (table: "OGMsg" | "DPMsg"): Promise<number[]> => {
        const rows = await bdd.raw<{ bucket: number; count: number }>(
          `SELECT CAST((julianday('now') - julianday(date)) / 2.5 AS INTEGER) AS bucket, COUNT(*) AS count FROM ${table} WHERE date >= datetime('now', '-30 day') GROUP BY bucket ORDER BY bucket DESC`,
          []
        );
        const series = new Array(12).fill(0);
        for (const r of rows) {
          if (r.bucket >= 0 && r.bucket < 12) {
            series[11 - r.bucket] = Number(r.count);
          }
        }
        return series;
      };
      const messagesSeries = await buildSeries("OGMsg");
      const relaysSeries = await buildSeries("DPMsg");

      const buildSnapshotSeries = async (field: "servers_count" | "channels_count"): Promise<number[]> => {
        const snaps = await getSnapshotsBetween(30, 0);
        if (snaps.length === 0) {
          return new Array(12).fill(field === "servers_count" ? serversNow : channelsNow);
        }
        const series: number[] = [];
        for (let i = 0; i < 12; i++) {
          const idx = Math.floor((i / 11) * (snaps.length - 1));
          const s = snaps[idx];
          series.push(s[field]);
        }
        return series;
      };
      const serversSeries = await buildSnapshotSeries("servers_count");
      const channelsSeries = await buildSnapshotSeries("channels_count");

      res.json({
        servers: { value: serversNow, delta: absDelta(serversNow, serversPrev), series: serversSeries },
        channels: { value: channelsNow, delta: absDelta(channelsNow, channelsPrev), series: channelsSeries },
        messages: { value: messagesNow, delta: pctDelta(messagesNow, messagesPrev), series: messagesSeries },
        relays: { value: relaysNow, delta: pctDelta(relaysNow, relaysPrev), series: relaysSeries },
      });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "INTERNAL_KPIS_ERROR" });
    }
  });

  app.get("/internal/servers", async (req: Request, res: Response) => {
    try {
      const limit = Math.max(1, Math.min(100, Number(req.query.limit ?? 8)));
      const offset = Math.max(0, Number(req.query.offset ?? 0));
      const bdd = await getBddInstance();

      const guilds = Array.from(client.guilds.cache.values());
      const enriched = [] as Array<{
        id: string;
        name: string;
        memberCount: number;
        relays30j: number;
        status: "ok" | "lag" | "off";
        sparkline: number[];
        accentColor: string;
        sigil: string;
      }>;

      for (const g of guilds) {
        const relayRows = await bdd.raw<{ total: number }>(
          "SELECT COUNT(*) AS total FROM DPMsg d JOIN ChannelPartner c ON d.id_channel = c.id_channel WHERE c.id_guild = ? AND d.date >= datetime('now', '-30 day')",
          [g.id]
        );
        const relays30j = Number(relayRows[0]?.total ?? 0);

        const lastRows = await bdd.raw<{ last_ts: string | null; hours_ago: number | null }>(
          "SELECT MAX(d.date) AS last_ts, (julianday('now') - julianday(MAX(d.date))) * 24 AS hours_ago FROM DPMsg d JOIN ChannelPartner c ON d.id_channel = c.id_channel WHERE c.id_guild = ?",
          [g.id]
        );
        let status: "ok" | "lag" | "off" = "off";
        const hoursAgo = lastRows[0]?.hours_ago;
        if (hoursAgo !== null && hoursAgo !== undefined) {
          if (hoursAgo < 24) {
            status = "ok";
          } else if (hoursAgo < 24 * 7) {
            status = "lag";
          }
        }

        const sparkRows = await bdd.raw<{ bucket: number; count: number }>(
          "SELECT CAST((julianday('now') - julianday(d.date)) / 3 AS INTEGER) AS bucket, COUNT(*) AS count FROM DPMsg d JOIN ChannelPartner c ON d.id_channel = c.id_channel WHERE c.id_guild = ? AND d.date >= datetime('now', '-30 day') GROUP BY bucket ORDER BY bucket DESC",
          [g.id]
        );
        const sparkline = new Array(10).fill(0);
        for (const r of sparkRows) {
          if (r.bucket >= 0 && r.bucket < 10) {
            sparkline[9 - r.bucket] = Number(r.count);
          }
        }

        const memberCount = typeof g.memberCount === "number" ? g.memberCount : 0;
        enriched.push({
          id: g.id,
          name: g.name,
          memberCount,
          relays30j,
          status,
          sparkline,
          accentColor: deterministicColor(g.id),
          sigil: g.name.charAt(0).toUpperCase(),
        });
      }

      enriched.sort((a, b) => b.relays30j - a.relays30j);
      const paged = enriched.slice(offset, offset + limit);
      res.json({ servers: paged, total: enriched.length, limit, offset });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "INTERNAL_SERVERS_ERROR" });
    }
  });

  app.get("/internal/activity", async (req: Request, res: Response) => {
    try {
      const range = String(req.query.range ?? "30j");
      const daysMap: Record<string, number> = { "7j": 7, "30j": 30, "90j": 90 };
      if (!(range in daysMap)) {
        res.status(400).json({ error: "INVALID_RANGE", allowed: ["7j", "30j", "90j"] });
        return;
      }
      const days = daysMap[range];
      const bdd = await getBddInstance();

      const relayRows = await bdd.raw<{ day: string; count: number }>(
        "SELECT date(date) AS day, COUNT(*) AS count FROM DPMsg WHERE date >= datetime('now', ?) GROUP BY day ORDER BY day ASC",
        [`-${days} day`]
      );
      const scrimRows = await bdd.raw<{ day: string; count: number }>(
        "SELECT date(date) AS day, COUNT(*) AS count FROM Scrim WHERE date >= datetime('now', ?) GROUP BY day ORDER BY day ASC",
        [`-${days} day`]
      );

      const labels: string[] = [];
      const relays: number[] = [];
      const scrims: number[] = [];
      const relayMap = new Map(relayRows.map((r) => [r.day, Number(r.count)]));
      const scrimMap = new Map(scrimRows.map((r) => [r.day, Number(r.count)]));
      const today = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        const iso = d.toISOString().slice(0, 10);
        labels.push(iso.slice(5));
        relays.push(relayMap.get(iso) ?? 0);
        scrims.push(scrimMap.get(iso) ?? 0);
      }
      const sumRelays = relays.reduce((a, b) => a + b, 0);
      const avgPerDay = Number((sumRelays / days).toFixed(2));
      res.json({ range, labels, relays, scrims, avgPerDay });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "INTERNAL_ACTIVITY_ERROR" });
    }
  });

  app.get("/internal/servers/:id/modules", async (req: Request, res: Response) => {
    try {
      const guildId = String(req.params.id || "").trim();
      if (!/^\d{5,32}$/.test(guildId)) {
        res.status(400).json({ error: "INVALID_GUILD_ID" });
        return;
      }
      const bdd = await getBddInstance();
      const modules = await listModules(guildId);

      const relayRows = await bdd.raw<{ total: number }>(
        "SELECT COUNT(*) AS total FROM DPMsg d JOIN ChannelPartner c ON d.id_channel = c.id_channel WHERE c.id_guild = ? AND d.date >= datetime('now', '-30 day')",
        [guildId]
      );
      const scrimRows = await bdd.raw<{ total: number }>(
        "SELECT COUNT(*) AS total FROM Scrim WHERE id_guild = ? AND date >= datetime('now', '-30 day')",
        [guildId]
      );
      const recruteRows = await bdd.raw<{ total: number }>(
        "SELECT COUNT(*) AS total FROM Recrute WHERE id_guild = ? AND date >= datetime('now', '-30 day')",
        [guildId]
      );
      const annonceRows = await bdd.raw<{ total: number }>(
        "SELECT COUNT(*) AS total FROM AdhesionInterval WHERE guild_id = ?",
        [guildId]
      );
      const linkRows = await bdd.raw<{ total: number }>(
        "SELECT COUNT(*) AS total FROM UserLink WHERE linked_at IS NOT NULL",
        []
      );

      const counters: Record<ModuleKey, number> = {
        annonces: Number(annonceRows[0]?.total ?? 0),
        scrims: Number(scrimRows[0]?.total ?? 0),
        recrutement: Number(recruteRows[0]?.total ?? 0),
        notifications: Number(relayRows[0]?.total ?? 0),
        oauth: Number(linkRows[0]?.total ?? 0),
        stats: Number(relayRows[0]?.total ?? 0),
      };

      const enriched = modules.map((m) => ({ key: m.key, enabled: m.enabled, count30j: counters[m.key] }));
      res.json({ guildId, modules: enriched });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "INTERNAL_MODULES_ERROR" });
    }
  });

  app.put("/internal/servers/:id/modules/:moduleKey", async (req: Request, res: Response) => {
    try {
      const guildId = String(req.params.id || "").trim();
      const moduleKey = String(req.params.moduleKey || "").trim();
      if (!/^\d{5,32}$/.test(guildId)) {
        res.status(400).json({ error: "INVALID_GUILD_ID" });
        return;
      }
      if (!isValidModule(moduleKey)) {
        res.status(400).json({ error: "INVALID_MODULE_KEY", allowed: MODULE_KEYS });
        return;
      }
      if (moduleKey === "oauth") {
        res.status(403).json({ error: "MODULE_OAUTH_NON_TOGGLEABLE" });
        return;
      }
      const enabled = req.body?.enabled === true || req.body?.enabled === 1 || req.body?.enabled === "true";
      await setModuleEnabled(guildId, moduleKey as ModuleKey, enabled);
      res.json({ guildId, module: moduleKey, enabled });
    } catch (error) {
      res.status(500).json({ error: (error as Error).message || "INTERNAL_MODULE_TOGGLE_ERROR" });
    }
  });

  const port = Number(process.env.INTERNAL_API_PORT || 4400);
  const host = process.env.INTERNAL_API_HOST || "127.0.0.1";

  const server = app.listen(port, host, () => {
    console.log(`Internal API listening on http://${host}:${port}`);
  });

  return server;
}
