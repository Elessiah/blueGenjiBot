import test from "node:test";
import assert from "node:assert/strict";
import { Collection } from "discord.js";
import type { Client } from "discord.js";
import {
  HandleResolutionTimeoutError,
  resolutionWaves,
  resolveDiscordHandle,
  searchInWaves,
} from "../../notifications/resolveHandle.js";

const GENJI = "111111111111111111";
const RIVALS = "222222222222222222";
const PARTNER_A = "333333333333333333";
const PARTNER_B = "444444444444444444";

const FAST = { budgetMs: 1_000, concurrency: 5 };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// resolutionWaves
// ---------------------------------------------------------------------------

test("resolutionWaves met les serveurs BlueGenji en premiere vague, dans l'ordre du bot", () => {
  const guilds = [{ id: PARTNER_A }, { id: RIVALS }, { id: PARTNER_B }, { id: GENJI }];
  assert.deepEqual(resolutionWaves(guilds, [GENJI, RIVALS]), [
    [{ id: RIVALS }, { id: GENJI }],
    [{ id: PARTNER_A }, { id: PARTNER_B }],
  ]);
});

test("resolutionWaves ignore un serveur BlueGenji que le bot ne partage pas", () => {
  const guilds = [{ id: PARTNER_A }];
  assert.deepEqual(resolutionWaves(guilds, [GENJI]), [[], [{ id: PARTNER_A }]]);
});

test("resolutionWaves sans serveur BlueGenji configure laisse tout en seconde vague", () => {
  const guilds = [{ id: GENJI }, { id: PARTNER_A }];
  assert.deepEqual(resolutionWaves(guilds, []), [[], guilds]);
});

// ---------------------------------------------------------------------------
// searchInWaves
// ---------------------------------------------------------------------------

test("searchInWaves rend le premier resultat et n'entame pas la vague suivante", async () => {
  const searched: string[] = [];
  const outcome = await searchInWaves(
    [["home"], ["partner"]],
    async (item) => { searched.push(item); return item === "home" ? "trouve" : null; },
    FAST,
  );
  assert.deepEqual(outcome, { status: "found", value: "trouve" });
  assert.deepEqual(searched, ["home"]);
});

test("searchInWaves passe a la vague suivante quand la premiere ne trouve rien", async () => {
  const searched: string[] = [];
  const outcome = await searchInWaves(
    [["home-1", "home-2"], ["partner"]],
    async (item) => { searched.push(item); return item === "partner" ? 42 : null; },
    FAST,
  );
  assert.deepEqual(outcome, { status: "found", value: 42 });
  assert.deepEqual(searched, ["home-1", "home-2", "partner"]);
});

test("searchInWaves rend l'absence une fois tout interroge", async () => {
  const outcome = await searchInWaves([["a", "b"], ["c"]], async () => null, FAST);
  assert.deepEqual(outcome, { status: "not-found" });
});

test("searchInWaves sans aucun element rend l'absence sans attendre", async () => {
  assert.deepEqual(await searchInWaves([[], []], async () => "x", FAST), { status: "not-found" });
  assert.deepEqual(await searchInWaves([], async () => "x", FAST), { status: "not-found" });
});

test("searchInWaves compte une recherche qui leve pour une absence, sans arreter les autres", async () => {
  const outcome = await searchInWaves(
    [["casse", "bon"]],
    async (item) => {
      if (item === "casse") throw new Error("Missing Access");
      return "membre";
    },
    FAST,
  );
  assert.deepEqual(outcome, { status: "found", value: "membre" });
});

test("searchInWaves mene les recherches de front sans depasser le parallelisme", async () => {
  let active = 0;
  let peak = 0;
  const started = Date.now();
  const outcome = await searchInWaves(
    [Array.from({ length: 10 }, (_, i) => i)],
    async () => {
      active++;
      peak = Math.max(peak, active);
      await sleep(40);
      active--;
      return null;
    },
    { budgetMs: 2_000, concurrency: 3 },
  );
  assert.deepEqual(outcome, { status: "not-found" });
  assert.equal(peak, 3);
  // Dix recherches de 40 ms, trois de front : quatre tours, pas dix.
  assert.ok(Date.now() - started < 400, `trop lent : ${Date.now() - started} ms`);
});

test("searchInWaves ramene un parallelisme nul ou fractionnaire a au moins un", async () => {
  let peak = 0;
  let active = 0;
  const outcome = await searchInWaves(
    [["a", "b", "c"]],
    async () => { active++; peak = Math.max(peak, active); await sleep(5); active--; return null; },
    { budgetMs: 1_000, concurrency: 0.4 },
  );
  assert.deepEqual(outcome, { status: "not-found" });
  assert.equal(peak, 1);
});

test("searchInWaves rend l'echeance quand une recherche ne repond pas", async () => {
  const started = Date.now();
  const outcome = await searchInWaves(
    [["muet"]],
    () => new Promise<null>(() => { /* ne se resout jamais */ }),
    { budgetMs: 60, concurrency: 5 },
  );
  assert.deepEqual(outcome, { status: "timeout" });
  assert.ok(Date.now() - started < 500);
});

test("searchInWaves partage un seul delai entre les vagues", async () => {
  const outcome = await searchInWaves(
    [["lent"], ["muet"]],
    async (item) => {
      if (item === "lent") { await sleep(50); return null; }
      return new Promise<null>(() => { /* ne se resout jamais */ });
    },
    { budgetMs: 80, concurrency: 5 },
  );
  assert.deepEqual(outcome, { status: "timeout" });
});

test("searchInWaves rend l'echeance, pas l'absence, quand des elements restaient a lancer", async () => {
  const outcome = await searchInWaves(
    [["lent", "jamais-lance"]],
    async () => { await sleep(100); return null; },
    { budgetMs: 30, concurrency: 1 },
  );
  assert.deepEqual(outcome, { status: "timeout" });
});

test("searchInWaves transmet le temps restant, decroissant", async () => {
  let clock = 1_000;
  const seen: number[] = [];
  const outcome = await searchInWaves(
    [["a"], ["b"]],
    async (_item, remainingMs) => { seen.push(remainingMs); clock += 300; return null; },
    { budgetMs: 1_000, concurrency: 1, now: () => clock },
  );
  assert.deepEqual(outcome, { status: "not-found" });
  assert.deepEqual(seen, [1_000, 700]);
});

test("searchInWaves n'entame pas une vague dont le delai est deja epuise", async () => {
  let clock = 0;
  const searched: string[] = [];
  const outcome = await searchInWaves(
    [["a"], ["b"]],
    async (item) => { searched.push(item); clock += 1_000; return null; },
    { budgetMs: 500, concurrency: 1, now: () => clock },
  );
  assert.deepEqual(outcome, { status: "timeout" });
  assert.deepEqual(searched, ["a"]);
});

// ---------------------------------------------------------------------------
// resolveDiscordHandle
// ---------------------------------------------------------------------------

type FakeMember = { id: string; user: { username: string; discriminator: string } };

interface FakeGuildSpec {
  /** Membres renvoyés par une recherche à la passerelle. */
  members?: FakeMember[];
  /** Membres déjà en cache. */
  cached?: FakeMember[];
  /** La recherche lève (serveur injoignable). */
  fails?: boolean;
  /** La recherche ne répond jamais. */
  hangs?: boolean;
}

type FetchCall = { guildId: string; options: { query: string; limit: number; time?: number } };

const member = (id: string, username: string, discriminator = "0"): FakeMember =>
  ({ id, user: { username, discriminator } });

function fakeClient(guilds: Record<string, FakeGuildSpec>, calls: FetchCall[] = []): Client {
  const cache = new Collection<string, unknown>();
  for (const [guildId, spec] of Object.entries(guilds)) {
    cache.set(guildId, {
      id: guildId,
      members: {
        cache: new Collection((spec.cached ?? []).map((m) => [m.id, m])),
        fetch: (options: FetchCall["options"]) => {
          calls.push({ guildId, options });
          if (spec.hangs) return new Promise(() => { /* ne se resout jamais */ });
          if (spec.fails) return Promise.reject(new Error("Missing Access"));
          const found = (spec.members ?? []).filter((m) =>
            m.user.username.toLowerCase().startsWith(options.query.toLowerCase()));
          return Promise.resolve(new Collection(found.map((m) => [m.id, m])));
        },
      },
    });
  }
  return { guilds: { cache } } as unknown as Client;
}

function withHomes(run: () => Promise<void>) {
  const saved = { GUILD_ID: process.env.GUILD_ID, SERV_GENJI: process.env.SERV_GENJI, SERV_RIVALS: process.env.SERV_RIVALS };
  Object.assign(process.env, { GUILD_ID: "", SERV_GENJI: GENJI, SERV_RIVALS: RIVALS });
  return run().finally(() => Object.assign(process.env, saved));
}

test("resolveDiscordHandle rend un identifiant numerique sans interroger aucun serveur", () =>
  withHomes(async () => {
    const calls: FetchCall[] = [];
    const client = fakeClient({ [GENJI]: {} }, calls);
    assert.deepEqual(await resolveDiscordHandle(client, "123456789012345678", FAST), {
      discordId: "123456789012345678",
      matchedBy: "id",
    });
    assert.equal(calls.length, 0);
  }));

test("resolveDiscordHandle rend null sur un tag inexploitable, sans requete", () =>
  withHomes(async () => {
    const calls: FetchCall[] = [];
    assert.equal(await resolveDiscordHandle(fakeClient({ [GENJI]: {} }, calls), "  @ ", FAST), null);
    assert.equal(calls.length, 0);
  }));

test("resolveDiscordHandle trouve d'abord dans le cache, sans requete a la passerelle", () =>
  withHomes(async () => {
    const calls: FetchCall[] = [];
    const client = fakeClient({ [PARTNER_A]: { cached: [member("900000000000000001", "Joueur")] } }, calls);
    assert.deepEqual(await resolveDiscordHandle(client, "@joueur", FAST), {
      discordId: "900000000000000001",
      matchedBy: "tag",
    });
    assert.equal(calls.length, 0);
  }));

test("resolveDiscordHandle ne sollicite aucun serveur partenaire quand le joueur est sur BlueGenji", () =>
  withHomes(async () => {
    const calls: FetchCall[] = [];
    const client = fakeClient({
      [PARTNER_A]: { members: [member("900000000000000009", "joueur")] },
      [GENJI]: { members: [member("900000000000000001", "joueur")] },
      [PARTNER_B]: {},
    }, calls);
    assert.deepEqual(await resolveDiscordHandle(client, "joueur", FAST), {
      discordId: "900000000000000001",
      matchedBy: "tag",
    });
    assert.deepEqual(calls.map((c) => c.guildId), [GENJI]);
  }));

test("resolveDiscordHandle retrouve un membre du seul serveur partenaire", () =>
  withHomes(async () => {
    const calls: FetchCall[] = [];
    const client = fakeClient({
      [GENJI]: {},
      [RIVALS]: { fails: true },
      [PARTNER_A]: {},
      [PARTNER_B]: { members: [member("900000000000000002", "partenaire")] },
    }, calls);
    assert.deepEqual(await resolveDiscordHandle(client, "partenaire", FAST), {
      discordId: "900000000000000002",
      matchedBy: "tag",
    });
    // Les deux serveurs BlueGenji sont interrogés avant tout partenaire.
    assert.deepEqual(calls.slice(0, 2).map((c) => c.guildId).sort(), [GENJI, RIVALS]);
  }));

test("resolveDiscordHandle compare le seul username, casse ignoree, et le discriminant legacy", () =>
  withHomes(async () => {
    const client = fakeClient({
      [GENJI]: {
        members: [
          member("900000000000000003", "joueurbis"),
          member("900000000000000004", "Joueur", "0420"),
          member("900000000000000005", "joueur", "1111"),
        ],
      },
    });
    assert.deepEqual(await resolveDiscordHandle(client, "JOUEUR#1111", FAST), {
      discordId: "900000000000000005",
      matchedBy: "tag",
    });
    assert.equal(await resolveDiscordHandle(client, "joueur#9999", FAST), null);
  }));

test("resolveDiscordHandle rend null quand aucun serveur ne connait le tag", () =>
  withHomes(async () => {
    const calls: FetchCall[] = [];
    const client = fakeClient({ [GENJI]: {}, [RIVALS]: {}, [PARTNER_A]: { fails: true }, [PARTNER_B]: {} }, calls);
    assert.equal(await resolveDiscordHandle(client, "fantome", FAST), null);
    assert.equal(calls.length, 4);
  }));

test("resolveDiscordHandle leve HandleResolutionTimeoutError quand un serveur ne repond pas", () =>
  withHomes(async () => {
    const client = fakeClient({ [GENJI]: {}, [PARTNER_A]: { hangs: true } });
    await assert.rejects(
      resolveDiscordHandle(client, "fantome", { budgetMs: 50, concurrency: 5 }),
      (error: unknown) => {
        assert.ok(error instanceof HandleResolutionTimeoutError);
        assert.equal(error.message, "BOT_RESOLVE_TIMEOUT");
        return true;
      },
    );
  }));

test("resolveDiscordHandle borne chaque recherche au-dela du delai total, jamais en deca", () =>
  withHomes(async () => {
    const calls: FetchCall[] = [];
    const client = fakeClient({ [GENJI]: {} }, calls);
    await resolveDiscordHandle(client, "fantome", { budgetMs: 1_000, concurrency: 5 });
    const time = calls[0]?.options.time ?? 0;
    // Le délai total doit tomber le premier : la recherche garde une marge.
    assert.ok(time > 1_000 && time <= 1_300, `time = ${time}`);
    assert.equal(calls[0]?.options.query, "fantome");
    assert.equal(calls[0]?.options.limit, 100);
  }));
