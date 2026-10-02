import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";

/**
 * Contrat site ↔ bot : chaque route `/internal/*` exercée par une vraie requête
 * HTTP sur un serveur monté par `startInternalApi`, avec une base SQLite
 * jetable et un client Discord simulé.
 *
 * Ce que le site lit (codes d'erreur, champs des réponses, plages d'activité)
 * est épinglé ici : un champ renommé ou un code changé casse ce fichier avant
 * de casser l'administration du site.
 */

const TMP_DIR = path.join(os.tmpdir(), `bgenji-internal-api-${randomUUID()}`);
fs.mkdirSync(TMP_DIR, { recursive: true });
const DB_FILE = path.join(TMP_DIR, "bot.sqlite");
process.env.BDD_PATH = DB_FILE;
process.env.OWNER_ID = "900000000000000001";
process.env.PRESIDENT = "900000000000000002";
process.env.INFO_SERV = "800000000000000001";
process.env.INTERNAL_API_PORT = "0";
process.env.INTERNAL_API_HOST = "127.0.0.1";
process.env.INTERNAL_API_TOKEN = "jeton-de-test";
process.env.GUILD_ID = "700000000000000001";
process.env.CLIENT_ID = "600000000000000001";

import type { Client } from "discord.js";
import { startInternalApi } from "../../internalApi.js";
import { getBddInstance, resetBddInstance } from "../../bdd/Bdd.js";
import { recordEvent } from "../../feed/feedBus.js";
import { readSiteVisitStats } from "../../siteVisits/siteVisits.js";
import { RESOLVE_BUDGET_MS } from "../../notifications/resolveHandle.js";

const TOKEN = "jeton-de-test";
const OWNER = process.env.OWNER_ID as string;
const PRESIDENT = process.env.PRESIDENT as string;

type FakeMember = {
  id: string;
  user: { username: string; discriminator: string; bot: boolean };
  send: (text: string) => Promise<{ id: string }>;
};

type FakeGuild = {
  id: string;
  name: string;
  memberCount: number;
  members: { fetch: (arg: unknown) => Promise<unknown> };
  roles: { fetch: (roleId: string) => Promise<unknown> };
};

/** Ce que le client simulé a vu passer, et les pannes qu'on lui impose. */
const state = {
  ready: true as boolean | "throw",
  ping: 42,
  logs: [] as string[],
  dms: [] as string[],
  unknownUsers: new Set<string>(),
  closedDms: new Set<string>(),
  /** Membres des serveurs « maison » (notify/dm), par identifiant. */
  homeMembers: new Map<string, FakeMember>(),
  /** La recherche par pseudo ne répond jamais (expiration). */
  searchHangs: false,
  /** Appelé à chaque recherche par pseudo. */
  onSearch: () => {},
  /** Lire le cache des serveurs lève (panne de résolution). */
  cacheThrows: false,
};

function member(id: string, username: string): FakeMember {
  return {
    id,
    user: { username, discriminator: "0", bot: false },
    send: async (text: string) => {
      if (state.closedDms.has(id)) { throw new Error("Cannot send messages to this user"); }
      state.dms.push(`${id}: ${text}`);
      return { id: "dm" };
    },
  };
}

function guild(id: string, name: string, memberCount: number): FakeGuild {
  return {
    id,
    name,
    memberCount,
    members: {
      fetch: async (arg: unknown) => {
        if (typeof arg === "string") {
          const found = state.homeMembers.get(arg);
          if (!found) { throw new Error("Unknown Member"); }
          return found;
        }
        state.onSearch();
        if (state.searchHangs) { return new Promise(() => {}); }
        const query = (arg as { query: string }).query.toLowerCase();
        return [...state.homeMembers.values()].filter((m) => m.user.username.toLowerCase() === query);
      },
    },
    roles: { fetch: async () => null },
  };
}

/** Serveurs rejoints : ce que voient `/internal/servers`, `/kpis` et les modules. */
const ALPHA = guild("111111111111111111", "alpha", 120);
const BETA = guild("222222222222222222", "beta", 30);
const joined = new Map<string, FakeGuild>([[ALPHA.id, ALPHA], [BETA.id, BETA]]);
/** Serveur « maison », joignable par `guilds.fetch` seulement (notify/dm). */
const HOME = guild(process.env.GUILD_ID as string, "BlueGenji", 500);

const fakeClient = {
  isReady: () => {
    if (state.ready === "throw") { throw new Error("client détruit"); }
    return state.ready;
  },
  ws: { get ping() { return state.ping; }, shards: { size: 1 } },
  shard: null,
  users: {
    fetch: async (id: string) => {
      if (state.unknownUsers.has(id)) { throw new Error("Unknown User"); }
      return {
        id,
        send: async (text: string) => {
          if (state.closedDms.has(id)) { throw new Error("Cannot send messages to this user"); }
          state.dms.push(`${id}: ${text}`);
          return { id: "dm" };
        },
      };
    },
  },
  channels: {
    fetch: async () => ({
      send: async (text: string) => {
        state.logs.push(text);
        return { id: "log" };
      },
    }),
  },
  guilds: {
    get cache() {
      if (state.cacheThrows) { throw new Error("cache illisible"); }
      return joined;
    },
    fetch: async (id: string) => {
      if (id !== HOME.id) { throw new Error("Unknown Guild"); }
      return HOME;
    },
  },
} as unknown as Client;

let server: Server;
let baseUrl: string;

test.before(async () => {
  server = startInternalApi(fakeClient);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.beforeEach(() => {
  state.ready = true;
  state.ping = 42;
  state.logs.length = 0;
  state.dms.length = 0;
  state.unknownUsers.clear();
  state.closedDms.clear();
  state.homeMembers.clear();
  state.searchHangs = false;
  state.onSearch = () => {};
  state.cacheThrows = false;
  process.env.INTERNAL_API_TOKEN = TOKEN;
  process.env.INTERNAL_API_HOST = "127.0.0.1";
  process.env.CLIENT_ID = "600000000000000001";
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await resetBddInstance();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

type CallOptions = { method?: string; body?: unknown; token?: string | null; headers?: Record<string, string> };

async function call(route: string, options: CallOptions = {}): Promise<{ status: number; body: Record<string, unknown>; headers: Headers }> {
  const headers: Record<string, string> = { ...options.headers };
  const token = options.token === undefined ? TOKEN : options.token;
  if (token !== null) { headers["x-internal-token"] = token; }
  if (options.body !== undefined) { headers["content-type"] = "application/json"; }
  const response = await fetch(baseUrl + route, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {}, headers: response.headers };
}

async function sql(query: string, values: unknown[] = []): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw(query, values);
}

async function clearActivity(): Promise<void> {
  for (const table of ["ChannelPartner", "DPMsg", "OGMsg", "Scrim", "Recrute", "ActivityDaily", "DailySnapshot", "ServerModule", "AdhesionInterval", "RefereeRole"]) {
    await sql(`DELETE FROM ${table}`);
  }
}

/** Mois-jour UTC d'il y a `days` jours, comme les étiquettes de `/internal/activity`. */
function label(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(5, 10);
}

// --- Authentification -------------------------------------------------------

test("auth : sans jeton ou avec un mauvais jeton, 401 UNAUTHORIZED", async () => {
  for (const token of [null, "mauvais", ""]) {
    const res = await call("/internal/invite", { token });
    assert.equal(res.status, 401, `jeton ${String(token)}`);
    assert.deepEqual(res.body, { error: "UNAUTHORIZED" });
  }
});

test("auth : le refus précède la route, même inconnue", async () => {
  const res = await call("/internal/route-inexistante", { token: null });
  assert.equal(res.status, 401);
});

test("auth : le bon jeton passe", async () => {
  const res = await call("/internal/invite");
  assert.equal(res.status, 200);
});

test("auth : sans INTERNAL_API_TOKEN, la boucle locale passe sans jeton", async () => {
  delete process.env.INTERNAL_API_TOKEN;
  const res = await call("/internal/invite", { token: null });
  assert.equal(res.status, 200);
});

test("auth : sans INTERNAL_API_TOKEN sur une interface publique, tout est refusé en 503", async () => {
  delete process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_HOST = "0.0.0.0";
  const res = await call("/internal/invite", { token: "peu-importe" });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: "INTERNAL_API_TOKEN_NOT_CONFIGURED" });
});

test("hors de /internal, aucune garde ni route ; aucune version de framework annoncée", async () => {
  const res = await fetch(baseUrl + "/ailleurs");
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("x-powered-by"), null);
});

// --- Santé, état, invitation ------------------------------------------------

test("/internal/health : client prêt et base lisible, 200 healthy", async () => {
  const res = await call("/internal/health");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: "healthy", checks: { discord: "ok", latency: 42, database: "ok" } });
});

test("/internal/health : client non prêt ou latence > 1 s, 503 unhealthy", async () => {
  state.ready = false;
  let res = await call("/internal/health");
  assert.equal(res.status, 503);
  assert.equal(res.body.status, "unhealthy");
  assert.equal((res.body.checks as Record<string, unknown>).discord, "down");

  state.ready = true;
  state.ping = 1500;
  res = await call("/internal/health");
  assert.equal(res.status, 503);
  assert.equal((res.body.checks as Record<string, unknown>).latency, 1500);
});

test("/internal/health : latence négative bornée à 0, client en panne signalé en error", async () => {
  state.ping = -1;
  let res = await call("/internal/health");
  assert.equal((res.body.checks as Record<string, unknown>).latency, 0);

  state.ready = "throw";
  res = await call("/internal/health");
  assert.equal(res.status, 503);
  assert.equal((res.body.checks as Record<string, unknown>).discord, "error");
});

test("/internal/status : forme de la réponse et état OPERATIONAL / DEGRADED / DOWN", async () => {
  let res = await call("/internal/status");
  assert.equal(res.status, 200);
  for (const field of ["startupTs", "uptimeMs", "version", "buildHash", "buildDate", "gatewayLatency", "cpuUsage", "ramUsage"]) {
    assert.ok(field in res.body, `${field} absent`);
  }
  assert.deepEqual(res.body.shardCount, { active: 1, total: 1 });
  assert.equal(res.body.gatewayLatency, 42);
  assert.ok((res.body.cpuUsage as number) >= 0 && (res.body.cpuUsage as number) <= 100);
  assert.equal(res.body.status, "OPERATIONAL");

  state.ping = 600;
  res = await call("/internal/status");
  assert.equal(res.body.status, "DEGRADED");

  state.ready = false;
  res = await call("/internal/status");
  assert.equal(res.body.status, "DOWN");
});

test("/internal/status : client en panne, 500 INTERNAL_STATUS_ERROR et détail au journal", async () => {
  state.ready = "throw";
  const res = await call("/internal/status");
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "INTERNAL_STATUS_ERROR" });
  assert.ok(state.logs.some((l) => l.startsWith("/internal/status error: client détruit")));
});

test("/internal/invite : lien d'autorisation OAuth2 du bot", async () => {
  const res = await call("/internal/invite");
  assert.deepEqual(res.body, {
    url: "https://discord.com/api/oauth2/authorize?client_id=600000000000000001&permissions=1099511627776&scope=bot%20applications.commands",
    permissions: "1099511627776",
    scopes: ["bot", "applications.commands"],
  });
});

test("/internal/invite : sans CLIENT_ID, 500 CLIENT_ID_NOT_CONFIGURED", async () => {
  delete process.env.CLIENT_ID;
  const res = await call("/internal/invite");
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "CLIENT_ID_NOT_CONFIGURED" });
});

// --- Statistiques -----------------------------------------------------------

test("/internal/stats : compteurs sur la fenêtre de conservation", async () => {
  await clearActivity();
  await sql("INSERT INTO ChannelPartner (id_channel, id_guild) VALUES ('c1', ?), ('c2', ?), ('c3', ?)", [ALPHA.id, ALPHA.id, BETA.id]);
  await sql("INSERT INTO OGMsg (id_msg, id_author, date) VALUES ('o1', 'u1', datetime('now')), ('o2', 'u1', datetime('now', '-1 day')), ('o3', 'u2', datetime('now', '-2 day')), ('o-old', 'u3', datetime('now', '-20 day'))");
  await sql("INSERT INTO DPMsg (id_msg, id_channel, id_og, date) VALUES ('d1', 'c1', 'o1', datetime('now')), ('d-old', 'c1', 'o-old', datetime('now', '-20 day'))");

  const res = await call("/internal/stats");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    affiliatedServers: 2,
    affiliatedChannels: 3,
    messagesLast7Days: 3,
    relayedMessagesLast7Days: 1,
    uniqueUsersLast7Days: 2,
    windowDays: 7,
  });
});

test("/internal/kpis : sans instantané, delta nul et séries plates à la valeur courante", async () => {
  await clearActivity();
  await sql("INSERT INTO ChannelPartner (id_channel, id_guild) VALUES ('c1', ?)", [ALPHA.id]);
  await sql("INSERT INTO OGMsg (id_msg, id_author, date) VALUES ('o1', 'u1', datetime('now')), ('o2', 'u1', datetime('now', '-3 day'))");
  await sql("INSERT INTO DPMsg (id_msg, id_channel, id_og, date) VALUES ('d1', 'c1', 'o1', datetime('now'))");

  const res = await call("/internal/kpis");
  assert.equal(res.status, 200);
  const servers = res.body.servers as { value: number; delta: string; series: number[] };
  const channels = res.body.channels as { value: number; delta: string; series: number[] };
  const messages = res.body.messages as { value: number; delta: null; series: number[] };
  const relays = res.body.relays as { value: number; delta: null; series: number[] };
  assert.deepEqual(servers, { value: 2, delta: "+0", series: new Array(12).fill(2) });
  assert.deepEqual(channels, { value: 1, delta: "+0", series: new Array(12).fill(1) });
  assert.equal(messages.value, 2);
  assert.equal(messages.delta, null);
  assert.equal(messages.series.length, 12);
  assert.equal(messages.series[11], 1, "message du jour dans le dernier point");
  assert.equal(messages.series.reduce((a, b) => a + b, 0), 2);
  assert.equal(relays.value, 1);
  assert.equal(relays.series[11], 1);
  assert.equal(res.body.windowDays, 7);
});

test("/internal/kpis : l'instantané d'il y a 30 jours donne le delta, les instantanés la série", async () => {
  await clearActivity();
  await sql("INSERT INTO ChannelPartner (id_channel, id_guild) VALUES ('c1', ?), ('c2', ?), ('c3', ?)", [ALPHA.id, ALPHA.id, BETA.id]);
  await sql("INSERT INTO DailySnapshot (date, servers_count, channels_count) VALUES (date('now', '-30 day'), 5, 1), (date('now'), 2, 3)");

  const res = await call("/internal/kpis");
  const servers = res.body.servers as { delta: string; series: number[] };
  const channels = res.body.channels as { delta: string; series: number[] };
  assert.equal(servers.delta, "-3");
  assert.equal(channels.delta, "+2");
  assert.equal(servers.series[0], 5, "le plus ancien instantané ouvre la série");
  assert.equal(servers.series[11], 2, "le plus récent la ferme");
  assert.equal(channels.series.length, 12);
});

test("/internal/servers : serveurs triés par relais, statut, sparkline et couleur", async () => {
  await clearActivity();
  await sql("INSERT INTO ChannelPartner (id_channel, id_guild) VALUES ('ca', ?), ('cb', ?)", [ALPHA.id, BETA.id]);
  await sql("INSERT INTO DPMsg (id_msg, id_channel, id_og, date) VALUES ('d1', 'ca', 'o', datetime('now')), ('d2', 'ca', 'o', datetime('now')), ('d3', 'ca', 'o', datetime('now', '-3 day')), ('d4', 'cb', 'o', datetime('now', '-3 day'))");

  const res = await call("/internal/servers");
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.limit, 8);
  assert.equal(res.body.offset, 0);
  assert.equal(res.body.windowDays, 7);
  const [first, second] = res.body.servers as Array<Record<string, unknown>>;
  assert.equal(first.id, ALPHA.id);
  assert.equal(first.name, "alpha");
  assert.equal(first.memberCount, 120);
  assert.equal(first.relays7j, 3);
  assert.equal(first.status, "ok");
  assert.equal(first.sigil, "A");
  assert.match(first.accentColor as string, /^hsl\(\d+, 65%, 50%\)$/);
  assert.equal((first.sparkline as number[]).length, 10);
  assert.equal((first.sparkline as number[])[9], 2);
  assert.equal(second.id, BETA.id);
  assert.equal(second.relays7j, 1);
  assert.equal(second.status, "lag", "dernier relais il y a trois jours");
});

test("/internal/servers : un serveur sans relais est « off »", async () => {
  await clearActivity();
  const res = await call("/internal/servers");
  for (const s of res.body.servers as Array<Record<string, unknown>>) {
    assert.equal(s.status, "off");
    assert.equal(s.relays7j, 0);
    assert.deepEqual(s.sparkline, new Array(10).fill(0));
  }
});

test("/internal/servers : pagination et bornes de limit/offset", async () => {
  await clearActivity();
  let res = await call("/internal/servers?limit=1&offset=1");
  assert.equal((res.body.servers as unknown[]).length, 1);
  assert.equal(res.body.limit, 1);
  assert.equal(res.body.offset, 1);

  res = await call("/internal/servers?limit=500");
  assert.equal(res.body.limit, 100);
  res = await call("/internal/servers?limit=0&offset=-4");
  assert.equal(res.body.limit, 1);
  assert.equal(res.body.offset, 0);
});

test("/internal/servers : limit/offset illisibles retombent sur les valeurs par défaut", async () => {
  const res = await call("/internal/servers?limit=abc&offset=xyz");
  assert.equal(res.status, 200);
  assert.equal(res.body.limit, 8);
  assert.equal(res.body.offset, 0);
  assert.equal((res.body.servers as unknown[]).length, 2);
});

// --- Activité (plages 7j / 30j / 90j) ---------------------------------------

test("/internal/activity : plage inconnue, 400 INVALID_RANGE avec les plages admises", async () => {
  const res = await call("/internal/activity?range=1an");
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "INVALID_RANGE", allowed: ["7j", "30j", "90j"] });
});

test("/internal/activity : 7j par défaut, jour par jour jusqu'à aujourd'hui", async () => {
  await clearActivity();
  await sql("INSERT INTO DPMsg (id_msg, id_channel, id_og, date) VALUES ('d1', 'c', 'o', datetime('now')), ('d2', 'c', 'o', datetime('now')), ('d3', 'c', 'o', datetime('now', '-2 day')), ('d-old', 'c', 'o', datetime('now', '-20 day'))");
  await sql("INSERT INTO Scrim (id_author, game, level, id_guild, date) VALUES ('u', 'ow', 'gold', ?, datetime('now'))", [ALPHA.id]);

  const res = await call("/internal/activity");
  assert.equal(res.status, 200);
  assert.equal(res.body.range, "7j");
  const labels = res.body.labels as string[];
  const relays = res.body.relays as number[];
  const scrims = res.body.scrims as number[];
  assert.equal(labels.length, 7);
  assert.equal(labels[6], label(0));
  assert.equal(labels[0], label(6));
  assert.equal(relays[6], 2);
  assert.equal(relays[4], 1);
  assert.equal(relays.reduce((a, b) => a + b, 0), 3, "relais hors fenêtre exclus");
  assert.equal(scrims[6], 1);
  assert.equal(res.body.avgPerDay, Number((3 / 7).toFixed(2)));
  assert.equal(res.body.windowDays, 7);
});

test("/internal/activity : 30j et 90j, relais bornés à la conservation, scrims repliés comptés", async () => {
  await clearActivity();
  await sql("INSERT INTO DPMsg (id_msg, id_channel, id_og, date) VALUES ('d1', 'c', 'o', datetime('now')), ('d-old', 'c', 'o', datetime('now', '-20 day'))");
  await sql("INSERT INTO Scrim (id_author, game, level, id_guild, date) VALUES ('u', 'ow', 'gold', ?, datetime('now', '-10 day'))", [ALPHA.id]);
  await sql("INSERT INTO ActivityDaily (kind, day, id_guild, detail, count) VALUES ('scrim', date('now', '-60 day'), '', '', 4), ('recrute', date('now', '-60 day'), '', '', 9)");

  const month = await call("/internal/activity?range=30j");
  assert.equal((month.body.labels as string[]).length, 30);
  assert.equal((month.body.relays as number[]).reduce((a, b) => a + b, 0), 1, "relais d'il y a 20 jours hors conservation");
  assert.equal((month.body.scrims as number[])[19], 1);
  assert.equal((month.body.scrims as number[]).reduce((a, b) => a + b, 0), 1, "le repli d'il y a 60 jours sort de la plage");
  assert.equal(month.body.avgPerDay, Number((1 / 7).toFixed(2)), "moyenne sur les jours conservés");

  const quarter = await call("/internal/activity?range=90j");
  const scrims = quarter.body.scrims as number[];
  assert.equal(scrims.length, 90);
  assert.equal(scrims[29], 4, "compteur journalier ActivityDaily");
  assert.equal(scrims.reduce((a, b) => a + b, 0), 5, "les recrutements repliés ne comptent pas");
});

// --- Modules par serveur ----------------------------------------------------

test("/internal/servers/:id/modules : identifiant invalide 400, serveur non rejoint 404", async () => {
  let res = await call("/internal/servers/abc/modules");
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "INVALID_GUILD_ID" });
  res = await call("/internal/servers/333333333333333333/modules");
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "GUILD_NOT_JOINED" });
});

test("/internal/servers/:id/modules : modules actifs par défaut avec leurs compteurs sur 30 jours", async () => {
  await clearActivity();
  await sql("INSERT INTO Scrim (id_author, game, level, id_guild, date) VALUES ('u', 'ow', 'gold', ?, datetime('now')), ('u', 'ow', 'gold', ?, datetime('now', '-40 day')), ('u', 'ow', 'gold', ?, datetime('now'))", [ALPHA.id, ALPHA.id, BETA.id]);
  await sql("INSERT INTO Recrute (id_author, role, id_guild, date) VALUES ('u', 'tank', ?, datetime('now'))", [ALPHA.id]);
  await sql("INSERT INTO AdhesionInterval (message, guild_id, author_id, interval_days) VALUES ('m', ?, 'a', 7), ('m', ?, 'a', 7)", [ALPHA.id, ALPHA.id]);

  const res = await call(`/internal/servers/${ALPHA.id}/modules`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, {
    guildId: ALPHA.id,
    modules: [
      { key: "annonces", enabled: true, count30j: 2 },
      { key: "scrims", enabled: true, count30j: 1 },
      { key: "recrutement", enabled: true, count30j: 1 },
    ],
  });
});

test("PUT /internal/servers/:id/modules/:key : validations", async () => {
  let res = await call("/internal/servers/abc/modules/scrims", { method: "PUT", body: { enabled: false } });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "INVALID_GUILD_ID" });
  res = await call(`/internal/servers/${ALPHA.id}/modules/inconnu`, { method: "PUT", body: { enabled: false } });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "INVALID_MODULE_KEY", allowed: ["annonces", "scrims", "recrutement"] });
  res = await call("/internal/servers/333333333333333333/modules/scrims", { method: "PUT", body: { enabled: false } });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "GUILD_NOT_JOINED" });
});

test("PUT /internal/servers/:id/modules/:key : bascule lue par la route GET", async () => {
  await clearActivity();
  let res = await call(`/internal/servers/${ALPHA.id}/modules/scrims`, { method: "PUT", body: { enabled: false } });
  assert.deepEqual(res.body, { guildId: ALPHA.id, module: "scrims", enabled: false });
  const read = await call(`/internal/servers/${ALPHA.id}/modules`);
  assert.equal((read.body.modules as Array<{ key: string; enabled: boolean }>).find((m) => m.key === "scrims")?.enabled, false);

  for (const enabled of [true, 1, "true"]) {
    res = await call(`/internal/servers/${ALPHA.id}/modules/scrims`, { method: "PUT", body: { enabled } });
    assert.equal(res.body.enabled, true, `valeur ${JSON.stringify(enabled)}`);
  }
  for (const enabled of ["oui", 0, null]) {
    res = await call(`/internal/servers/${ALPHA.id}/modules/scrims`, { method: "PUT", body: { enabled } });
    assert.equal(res.body.enabled, false, `valeur ${JSON.stringify(enabled)}`);
  }
  res = await call(`/internal/servers/${ALPHA.id}/modules/scrims`, { method: "PUT" });
  assert.equal(res.body.enabled, false, "corps absent : désactivé");
});

// --- Connexion par code -----------------------------------------------------

test("/internal/auth/resolve : handle absent, 400 INVALID_PAYLOAD", async () => {
  for (const body of [{}, { handle: "   " }]) {
    const res = await call("/internal/auth/resolve", { body });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "INVALID_PAYLOAD" });
  }
});

test("/internal/auth/resolve : un identifiant numérique est rendu tel quel", async () => {
  const res = await call("/internal/auth/resolve", { body: { handle: "123456789012345678" } });
  assert.deepEqual(res.body, { discordId: "123456789012345678", matchedBy: "id" });
});

test("/internal/auth/resolve : pseudo trouvé dans un serveur rejoint, sinon 404", async () => {
  state.homeMembers.set("555555555555555555", member("555555555555555555", "Joueur"));
  let res = await call("/internal/auth/resolve", { body: { handle: "@joueur" } });
  assert.deepEqual(res.body, { discordId: "555555555555555555", matchedBy: "tag" });

  res = await call("/internal/auth/resolve", { body: { handle: "personne" } });
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { error: "DISCORD_USER_NOT_FOUND" });
});

test("/internal/auth/resolve : panne de résolution, 500 sans le pseudo au journal", async () => {
  state.cacheThrows = true;
  const res = await call("/internal/auth/resolve", { body: { handle: "pseudo-secret" } });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "INTERNAL_RESOLVE_ERROR" });
  assert.equal(state.logs.length, 1);
  assert.ok(!state.logs[0].includes("pseudo-secret"), "le pseudo ne part pas au journal");
});

test("/internal/auth/resolve : serveurs muets, 504 BOT_RESOLVE_TIMEOUT sans journal Discord", async (t) => {
  t.mock.method(console, "warn", () => {});
  // Horloge simulée : l'échéance de 2,5 s tombe sur commande, pas en vrai.
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() });
  let searched = 0;
  state.searchHangs = true;
  state.onSearch = () => { searched++; };
  const pending = call("/internal/auth/resolve", { body: { handle: "lent" } });
  for (let i = 0; i < 1000 && searched < joined.size; i++) { await new Promise((r) => setImmediate(r)); }
  assert.equal(searched, joined.size, "chaque serveur rejoint interrogé");
  t.mock.timers.tick(RESOLVE_BUDGET_MS);
  const res = await pending;
  assert.equal(res.status, 504);
  assert.deepEqual(res.body, { error: "BOT_RESOLVE_TIMEOUT" });
  assert.deepEqual(state.logs, []);
});

test("/internal/auth/send-code : identifiant ou code invalide, 400", async () => {
  const bodies = [
    { discordId: "123", code: "123456" },
    { discordId: "123456789012345678", code: "12345" },
    { discordId: "123456789012345678", code: "abcdef" },
    { discordId: "123456789012345678" },
  ];
  for (const body of bodies) {
    const res = await call("/internal/auth/send-code", { body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.deepEqual(res.body, { error: "INVALID_PAYLOAD" });
  }
  assert.deepEqual(state.dms, []);
});

test("/internal/auth/send-code : code envoyé en MP et inscrit au flux sans nommer le joueur", async () => {
  const res = await call("/internal/auth/send-code", { body: { discordId: " 123456789012345678 ", code: "042137" } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true });
  assert.deepEqual(state.dms, ["123456789012345678: BlueGenji Arena - Code de connexion: **042137** (valide 10 minutes)."]);
  const bdd = await getBddInstance();
  const [last] = await bdd.raw<{ type: string; summary: string; target: string | null }>("SELECT type, summary, target FROM FeedEvent ORDER BY id DESC LIMIT 1");
  assert.equal(last.type, "auth");
  assert.equal(last.target, null);
  assert.ok(!last.summary.includes("123456789012345678"));
});

test("/internal/auth/send-code : MP fermés, 500 DISCORD_DM_FAILED", async () => {
  state.closedDms.add("123456789012345678");
  const res = await call("/internal/auth/send-code", { body: { discordId: "123456789012345678", code: "111111" } });
  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { error: "DISCORD_DM_FAILED" });
  assert.ok(state.logs.some((l) => l.includes("Failed to send auth code")));
  assert.ok(state.logs.every((l) => !l.includes("111111")), "le code ne part pas au journal");
});

// --- Journal et fréquentation -----------------------------------------------

test("/internal/log : message vide 400 MISSING_MESSAGE, sinon relayé préfixé", async () => {
  let res = await call("/internal/log", { body: { message: "  " } });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "MISSING_MESSAGE" });

  res = await call("/internal/log", { body: { message: " sauvegarde faite " } });
  assert.deepEqual(res.body, { success: true });
  assert.deepEqual(state.logs, ["[AppBlueGenji] sauvegarde faite"]);
});

test("/internal/site-visits : corps inexploitable, 400 INVALID_SITE_VISIT_STATS", async () => {
  for (const body of [[], { autre: 1 }]) {
    const res = await call("/internal/site-visits", { body });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "INVALID_SITE_VISIT_STATS" });
  }
});

test("/internal/site-visits : instantané enregistré pour /stats-site", async () => {
  const res = await call("/internal/site-visits", { body: { totalVisits: 120, uniqueVisitors: 40, visitsLast7Days: 12 } });
  assert.deepEqual(res.body, { success: true });
  const stored = await readSiteVisitStats();
  assert.equal(stored?.totalVisits, 120);
  assert.equal(stored?.uniqueVisitors, 40);
  assert.equal(stored?.visitsLast7Days, 12);
  assert.equal(stored?.visitsLast24h, 0, "champ absent : 0");
});

// --- Notifications ----------------------------------------------------------

test("/internal/notify/dm : corps invalide, 400 INVALID_NOTIFICATION_PAYLOAD", async () => {
  for (const body of [{ message: "x" }, { message: "", recipients: [{ discordId: "123456789012345678" }] }, { message: "x", recipients: [{}] }]) {
    const res = await call("/internal/notify/dm", { body });
    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: "INVALID_NOTIFICATION_PAYLOAD" });
  }
});

test("/internal/notify/dm : bilan envoyé / introuvable / injoignable et résumé au journal", async () => {
  state.homeMembers.set("555555555555555555", member("555555555555555555", "joueur"));
  state.homeMembers.set("666666666666666666", member("666666666666666666", "ferme"));
  state.closedDms.add("666666666666666666");
  const res = await call("/internal/notify/dm", {
    body: {
      message: "Votre match commence",
      context: "rappel",
      recipients: [
        { discordId: "555555555555555555", label: "A" },
        { handle: "ferme", label: "B" },
        { discordId: "777777777777777777", label: "C" },
      ],
    },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { sent: 1, unresolved: ["C"], failed: ["B"] });
  assert.deepEqual(state.dms, ["555555555555555555: Votre match commence"]);
  assert.deepEqual(state.logs, ["[AppBlueGenji] rappel: 1 envoye(s), 1 introuvable(s), 1 injoignable(s)."]);
});

test("/internal/notify/dm : tout envoyé, aucun journal", async () => {
  state.homeMembers.set("555555555555555555", member("555555555555555555", "joueur"));
  const res = await call("/internal/notify/dm", { body: { message: "ok", recipients: [{ discordId: "555555555555555555" }] } });
  assert.deepEqual(res.body, { sent: 1, unresolved: [], failed: [] });
  assert.deepEqual(state.logs, []);
});

test("/internal/notify/dm : aucun serveur maison joignable, 503 HOME_GUILD_UNAVAILABLE", async (t) => {
  t.after(() => { process.env.GUILD_ID = HOME.id; });
  process.env.GUILD_ID = "999999999999999999";
  const res = await call("/internal/notify/dm", { body: { message: "x", recipients: [{ discordId: "555555555555555555" }] } });
  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { error: "HOME_GUILD_UNAVAILABLE" });
});

test("/internal/notify/referees : corps invalide 400, sinon journal préfixé et bilan", async () => {
  await clearActivity();
  let res = await call("/internal/notify/referees", { body: { context: "x" } });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "INVALID_NOTIFICATION_PAYLOAD" });

  await sql("INSERT INTO RefereeRole (id_guild, id_role) VALUES (?, 'role-perdu')", [ALPHA.id]);
  res = await call("/internal/notify/referees", { body: { message: "Litige match 4" } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { sent: 0, unresolved: ["alpha: rôle role-perdu introuvable"], failed: [] });
  assert.deepEqual(state.logs, ["[AppBlueGenji] Litige match 4"]);
});

test("/internal/notify/leadership : propriétaire et président prévenus, échec par identifiant", async () => {
  let res = await call("/internal/notify/leadership", { body: { message: "" } });
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: "INVALID_NOTIFICATION_PAYLOAD" });

  state.closedDms.add(PRESIDENT);
  res = await call("/internal/notify/leadership", { body: { message: "Contestation reçue" } });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { sent: 1, unresolved: [], failed: [PRESIDENT] });
  assert.deepEqual(state.dms, [`${OWNER}: [AppBlueGenji] Contestation reçue`]);
  assert.deepEqual(state.logs, ["[AppBlueGenji] Contestation reçue"]);
});

// --- Flux SSE ---------------------------------------------------------------

/** Lit le flux jusqu'à ce que `until` soit vrai sur le texte reçu. */
async function readStream(reader: ReadableStreamDefaultReader<Uint8Array>, until: (text: string) => boolean): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!until(text)) {
    const { value, done } = await reader.read();
    if (done) { break; }
    text += decoder.decode(value, { stream: true });
  }
  return text;
}

test("/internal/feed/stream : en-têtes SSE, arriéré puis événement en direct", async () => {
  await recordEvent(null, "relay", "arriere-1");
  const controller = new AbortController();
  const response = await fetch(baseUrl + "/internal/feed/stream", { headers: { "x-internal-token": TOKEN }, signal: controller.signal });
  try {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
    const reader = response.body!.getReader();
    const backlog = await readStream(reader, (t) => t.includes("arriere-1"));
    assert.match(backlog, /id: \d+\nevent: feed\ndata: \{.*"summary":"arriere-1".*\}\n\n/);

    await recordEvent(null, "scrim", "en-direct-1");
    const live = await readStream(reader, (t) => t.includes("en-direct-1"));
    assert.match(live, /event: feed\ndata: \{.*"type":"scrim".*\}/);
  } finally {
    controller.abort();
  }
});

test("/internal/feed/stream : Last-Event-ID ne rejoue que la suite", async () => {
  await recordEvent(null, "warn", "avant-reprise");
  const bdd = await getBddInstance();
  const [{ id }] = await bdd.raw<{ id: number }>("SELECT MAX(id) AS id FROM FeedEvent");
  await recordEvent(null, "warn", "apres-reprise");
  const controller = new AbortController();
  const response = await fetch(baseUrl + "/internal/feed/stream", {
    headers: { "x-internal-token": TOKEN, "last-event-id": String(id) },
    signal: controller.signal,
  });
  try {
    const text = await readStream(response.body!.getReader(), (t) => t.includes("apres-reprise"));
    assert.ok(!text.includes("avant-reprise"));
  } finally {
    controller.abort();
  }
});

test("/internal/feed/stream : sans jeton, 401 avant toute ouverture de flux", async () => {
  const res = await call("/internal/feed/stream", { token: null });
  assert.equal(res.status, 401);
});

// --- Erreurs du serveur HTTP -----------------------------------------------

test("erreur de socket ordinaire : journalisée, le bot continue", async (t) => {
  t.mock.method(console, "error", () => {});
  server.emit("error", Object.assign(new Error("connexion coupee"), { code: "ECONNRESET" }));
  for (let i = 0; i < 50 && !state.logs.some((l) => l.includes("connexion coupee")); i++) {
    await new Promise((r) => setImmediate(r));
  }
  assert.ok(state.logs.some((l) => l.startsWith("Internal API : ") && l.includes("connexion coupee")));
});

test("port déjà pris : sortie du process pour relance par pm2", async (t) => {
  t.mock.method(console, "error", () => {});
  const exits: Array<number | string | null | undefined> = [];
  t.mock.method(process, "exit", ((code?: number) => { exits.push(code); }) as typeof process.exit);
  const previousPort = process.env.INTERNAL_API_PORT;
  process.env.INTERNAL_API_PORT = String((server.address() as AddressInfo).port);
  try {
    const second = startInternalApi(fakeClient);
    await once(second, "error").catch(() => {});
    assert.deepEqual(exits, [1]);
  } finally {
    process.env.INTERNAL_API_PORT = previousPort;
  }
});

// --- Base indisponible : codes 500 stables ----------------------------------
// En dernier : la base est remplacée par un chemin qu'SQLite ne peut ouvrir.

test("base injoignable : chaque route répond son code d'erreur stable", async (t) => {
  t.mock.method(console, "log", () => {});
  await resetBddInstance();
  process.env.BDD_PATH = TMP_DIR; // un dossier : l'ouverture échoue à chaque essai

  const expectations: Array<[string, CallOptions, number, string]> = [
    ["/internal/stats", {}, 500, "INTERNAL_STATS_ERROR"],
    ["/internal/kpis", {}, 500, "INTERNAL_KPIS_ERROR"],
    ["/internal/servers", {}, 500, "INTERNAL_SERVERS_ERROR"],
    ["/internal/activity", {}, 500, "INTERNAL_ACTIVITY_ERROR"],
    [`/internal/servers/${ALPHA.id}/modules`, {}, 500, "INTERNAL_MODULES_ERROR"],
    [`/internal/servers/${ALPHA.id}/modules/scrims`, { method: "PUT", body: { enabled: true } }, 500, "INTERNAL_MODULE_TOGGLE_ERROR"],
    ["/internal/site-visits", { body: { totalVisits: 1 } }, 500, "SITE_VISIT_STATS_SAVE_FAILED"],
    ["/internal/notify/referees", { body: { message: "x" } }, 500, "NOTIFICATION_DELIVERY_FAILED"],
  ];
  for (const [route, options, status, code] of expectations) {
    const res = await call(route, options);
    assert.equal(res.status, status, route);
    assert.deepEqual(res.body, { error: code }, route);
  }

  const health = await call("/internal/health");
  assert.equal(health.status, 503);
  assert.equal((health.body.checks as Record<string, unknown>).database, "error");

  // Le flux a déjà envoyé ses en-têtes : il se ferme au lieu de répondre 500.
  const stream = await fetch(baseUrl + "/internal/feed/stream", { headers: { "x-internal-token": TOKEN } });
  assert.equal(stream.status, 200);
  assert.equal(await stream.text(), "");
  assert.ok(state.logs.some((l) => l.startsWith("/internal/feed/stream error:")));

  // Aucun message d'exception (chemin, SQL) ne part à l'appelant.
  assert.ok(state.logs.some((l) => l.startsWith("/internal/stats error:")));
});
