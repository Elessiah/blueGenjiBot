import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Base jetable désignée avant l'import : `getAdminRole` lit la table RoleAdmin.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-contact-admin-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, resetBddInstance } from "../../bdd/Bdd.js";
import { contactAdminServer } from "../../commandsHandlers/contactAdminServer.js";
import { PermissionsBitField } from "discord.js";
import type { ChatInputCommandInteraction, Client } from "discord.js";

/**
 * Caractérisation de `contactAdminServer` : pour chaque chemin, la trace
 * ordonnée de tout ce qui sort du bot (réponses à l'interaction, messages
 * privés, journal) et la valeur rendue.
 */

type FakeUser = { id: string; bot: boolean; send: (payload: unknown) => Promise<unknown> };
type FakeRole = { id: string; admin: boolean; members: string[] };

type ServerSetup = {
  /** `"throw"` : le serveur est illisible. */
  fetch?: "ok" | "throw";
  roles?: FakeRole[];
  /** Rôle configuré par `/set-admin-role` : `"missing"` = introuvable, `"throw"` = lecture en échec. */
  configured?: { id: string; members?: string[]; fetch?: "ok" | "missing" | "throw" };
  /** Comptes dont les messages privés sont fermés. */
  closedDms?: string[];
  /**
   * Cache incomplet (après redémarrage) : les rôles paraissent vides tant que
   * les membres du serveur n'ont pas été récupérés. `"throw"` : la
   * récupération échoue.
   */
  memberFetch?: "ok" | "throw";
};

function fakeClient(trace: string[], setup: ServerSetup): Client {
  const user = (id: string): FakeUser => ({
    id,
    // Convention des tests : un identifiant préfixé « bot » est un bot.
    bot: id.startsWith("bot"),
    send: async (payload: unknown) => {
      if (setup.closedDms?.includes(id)) throw new Error("Cannot send messages to this user");
      const text = typeof payload === "string" ? payload : String((payload as { content?: unknown }).content ?? "");
      trace.push(`dm:${id} ${text}`);
      return { id: "dm-" + trace.length };
    },
  });
  // Sans `memberFetch`, le cache est complet : rien n'est récupéré.
  let fetched = setup.memberFetch === undefined;
  const memberCache = new Map<string, unknown>();
  const asRole = (role: { id: string; admin?: boolean; members?: string[] }) => ({
    id: role.id,
    permissions: { has: (flag: bigint) => flag === PermissionsBitField.Flags.Administrator && Boolean(role.admin) },
    // Le cache ne contient que les administrateurs « connus » (préfixe k) tant
    // que le serveur n'a pas été récupéré.
    get members() {
      const ids = (role.members ?? []).filter((id) => fetched || id.startsWith("k"));
      return new Map(ids.map((id) => [id, { user: user(id) }]));
    },
  });
  const roles = (setup.roles ?? []).map(asRole);
  return {
    users: {
      fetch: async (id: string) => {
        if (id !== process.env.OWNER_ID) trace.push("users.fetch " + id);
        return user(id);
      },
    },
    channels: {
      fetch: async () => ({ send: async (text: string) => { trace.push("log " + text); return { id: "log" }; } }),
    },
    guilds: {
      fetch: async (id: string) => {
        trace.push("guilds.fetch " + id);
        if (setup.fetch === "throw") throw new Error("Unknown Guild");
        return {
          id,
          ownerId: "proprio",
          memberCount: setup.memberFetch === undefined ? 0 : 10,
          members: {
            cache: memberCache,
            fetch: async () => {
              trace.push("members.fetch *");
              if (setup.memberFetch === "throw") throw new Error("Members didn't arrive in time.");
              fetched = true;
              for (let i = 0; i < 10; i++) memberCache.set("m" + i, {});
            },
          },
          roles: {
            cache: { filter: (fn: (r: ReturnType<typeof asRole>) => boolean) => ({ values: () => roles.filter(fn).values() }) },
            fetch: async (roleId: string) => {
              trace.push("roles.fetch " + roleId);
              const c = setup.configured;
              if (c?.fetch === "throw") throw new Error("Missing Access");
              if (!c || c.fetch === "missing" || c.id !== roleId) return null;
              return asRole({ id: c.id, members: c.members });
            },
          },
        };
      },
    },
  } as unknown as Client;
}

type InteractionSetup = { allowed?: boolean; server?: string | null; message?: string | null };

function fakeInteraction(trace: string[], client: Client, setup: InteractionSetup): ChatInputCommandInteraction {
  return {
    client,
    user: { id: "caller" },
    member: setup.allowed === false ? null : { id: process.env.OWNER_ID },
    options: {
      getString: (name: string) => (name === "server" ? (setup.server ?? null) : (setup.message ?? null)),
    },
    deferReply: async (opts: unknown) => { trace.push("deferReply " + JSON.stringify(opts)); },
    reply: async (opts: { content: string; flags?: unknown }) => { trace.push(`reply${opts.flags ? " (éphémère)" : ""} ${opts.content}`); },
    editReply: async (opts: { content: string }) => { trace.push("editReply " + opts.content); },
  } as unknown as ChatInputCommandInteraction;
}

async function setAdminRole(guildId: string, roleId: string | null): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM RoleAdmin WHERE guild_id = ?", [guildId]);
  if (roleId) await bdd.raw("INSERT INTO RoleAdmin (guild_id, role_id) VALUES (?, ?)", [guildId, roleId]);
}

const DEFER = 'deferReply {"flags":64}';

test("appel interne sans serveur ni message : journalisé, échec", async () => {
  const trace: string[] = [];
  assert.equal(await contactAdminServer(fakeClient(trace, {}), undefined, "g1"), false);
  assert.equal(await contactAdminServer(fakeClient(trace, {}), undefined, undefined, "texte"), false);
  assert.deepEqual(trace, ["log Missing parameters for contactAdminServer!", "log Missing parameters for contactAdminServer!"]);
});

test("sans permission : refus en réponse, rien d'autre", async () => {
  const trace: string[] = [];
  const client = fakeClient(trace, {});
  assert.equal(await contactAdminServer(client, fakeInteraction(trace, client, { allowed: false, server: "g1", message: "m" })), false);
  assert.deepEqual(trace, [
    "reply (éphémère) You don't have permission to contact admin users.\n" +
      "Please contact 'Elessiah' or your server administrators to take appropriate action if needed.\n",
  ]);
});

test("commande sans serveur : différée puis refusée", async () => {
  const trace: string[] = [];
  const client = fakeClient(trace, {});
  assert.equal(await contactAdminServer(client, fakeInteraction(trace, client, { server: null, message: "m" })), false);
  assert.deepEqual(trace, [DEFER, "reply (éphémère) Failed to retrieve the parameter 'server'. Please try again !"]);
});

test("serveur illisible : réponse puis journal, ou journal seul en appel interne", async () => {
  const trace: string[] = [];
  const client = fakeClient(trace, { fetch: "throw" });
  assert.equal(await contactAdminServer(client, fakeInteraction(trace, client, { server: "g1", message: "m" })), false);
  assert.equal(await contactAdminServer(client, undefined, "g2", "m"), false);
  assert.deepEqual(trace, [
    DEFER, "guilds.fetch g1",
    "reply (éphémère) Internal error : Failed to fetch the targeted server ! Please try again.",
    "log Failed to fetch the targeted server : Unknown Guild",
    "guilds.fetch g2",
    "log Failed to fetch the targeted server : Unknown Guild",
  ]);
});

test("administrateurs par permission et rôle configuré, chacun servi une fois", async () => {
  await setAdminRole("g1", "staff");
  const trace: string[] = [];
  const client = fakeClient(trace, {
    roles: [
      { id: "admin", admin: true, members: ["a1", "a2"] },
      { id: "membre", admin: false, members: ["x1"] },
      { id: "admin2", admin: true, members: ["a2", "a3"] },
    ],
    configured: { id: "staff", members: ["a1", "s1"] },
  });
  assert.equal(await contactAdminServer(client, fakeInteraction(trace, client, { server: "g1", message: "Bonjour" })), true);
  assert.deepEqual(trace, [
    DEFER, "guilds.fetch g1", "roles.fetch staff",
    "dm:a1 Bonjour", "dm:a2 Bonjour", "dm:a3 Bonjour", "dm:s1 Bonjour",
    "editReply Message successfully sent to 4 admin(s) !",
  ]);
});

test("aucun administrateur : le propriétaire du serveur est prévenu", async () => {
  await setAdminRole("g1", null);
  const trace: string[] = [];
  const client = fakeClient(trace, { roles: [{ id: "membre", admin: false, members: ["x1"] }] });
  assert.equal(await contactAdminServer(client, undefined, "g1", "Alerte"), true);
  assert.deepEqual(trace, ["guilds.fetch g1", "users.fetch proprio", "dm:proprio Alerte"]);
});

test("rôle configuré introuvable ou illisible : journalisé, les autres servis", async () => {
  await setAdminRole("g1", "staff");
  const trace: string[] = [];
  const roles = [{ id: "admin", admin: true, members: ["a1"] }];
  assert.equal(await contactAdminServer(fakeClient(trace, { roles, configured: { id: "staff", fetch: "missing" } }), undefined, "g1", "m"), true);
  assert.equal(await contactAdminServer(fakeClient(trace, { roles, configured: { id: "staff", fetch: "throw" } }), undefined, "g1", "m"), true);
  assert.deepEqual(trace, [
    "guilds.fetch g1", "roles.fetch staff",
    "log Configured admin role with id 'staff' not found on guild 'g1'.",
    "dm:a1 m",
    "guilds.fetch g1", "roles.fetch staff",
    "log Failed to fetch configured admin role : Missing Access",
    "dm:a1 m",
  ]);
});

test("cache vide après redémarrage : les membres du serveur sont récupérés une fois, tous servis", async () => {
  await setAdminRole("g9", "staff");
  const trace: string[] = [];
  const client = fakeClient(trace, {
    roles: [{ id: "admin", admin: true, members: ["a1"] }, { id: "admin2", admin: true, members: ["a2"] }],
    configured: { id: "staff", members: ["s1"] },
    memberFetch: "ok",
  });
  assert.equal(await contactAdminServer(client, fakeInteraction(trace, client, { server: "g9", message: "Bonjour" })), true);
  assert.deepEqual(trace, [
    DEFER, "guilds.fetch g9", "members.fetch *", "roles.fetch staff",
    "dm:a1 Bonjour", "dm:a2 Bonjour", "dm:s1 Bonjour",
    "editReply Message successfully sent to 3 admin(s) !",
  ]);
});

test("@everyone administrateur : écarté, même après récupération d'un autre rôle", async () => {
  await setAdminRole("g9", null);
  const trace: string[] = [];
  const client = fakeClient(trace, {
    roles: [{ id: "admin", admin: true, members: ["a1"] }, { id: "g9", admin: true, members: ["k1", "x1", "x2"] }],
    memberFetch: "ok",
  });
  assert.equal(await contactAdminServer(client, undefined, "g9", "Alerte"), true);
  const alone = fakeClient(trace, { roles: [{ id: "g9", admin: true, members: ["k1", "x1"] }] });
  assert.equal(await contactAdminServer(alone, undefined, "g9", "Alerte"), true);
  assert.deepEqual(trace, [
    "guilds.fetch g9", "members.fetch *", "dm:a1 Alerte",
    "guilds.fetch g9", "users.fetch proprio", "dm:proprio Alerte",
  ]);
});

test("@everyone configuré comme rôle admin : écarté et journalisé, les autres servis", async () => {
  await setAdminRole("g9", "g9");
  const trace: string[] = [];
  const client = fakeClient(trace, {
    roles: [{ id: "admin", admin: true, members: ["a1"] }],
    configured: { id: "g9", members: ["x1", "x2"] },
    memberFetch: "ok",
  });
  assert.equal(await contactAdminServer(client, undefined, "g9", "Alerte"), true);
  assert.deepEqual(trace, [
    "guilds.fetch g9", "members.fetch *",
    "log Configured admin role is the everyone role on guild 'g9', ignored.",
    "dm:a1 Alerte",
  ]);
});

test("bots des rôles d'administration : écartés, ni MP ni échec ; le propriétaire si seuls des bots", async () => {
  await setAdminRole("g9", null);
  const trace: string[] = [];
  const roles = [{ id: "admin", admin: true, members: ["bot1", "a1", "bot2"] }];
  assert.equal(await contactAdminServer(fakeClient(trace, { roles }), undefined, "g9", "m"), true);
  const botsOnly = [{ id: "admin", admin: true, members: ["bot1"] }];
  assert.equal(await contactAdminServer(fakeClient(trace, { roles: botsOnly }), undefined, "g9", "m"), true);
  assert.deepEqual(trace, ["guilds.fetch g9", "dm:a1 m", "guilds.fetch g9", "users.fetch proprio", "dm:proprio m"]);
});

test("membres illisibles : une seule tentative, journal sans nom, les connus servis, l'auteur averti", async () => {
  await setAdminRole("g9", "staff");
  const trace: string[] = [];
  const client = fakeClient(trace, {
    roles: [{ id: "admin", admin: true, members: ["k1", "a1"] }, { id: "admin2", admin: true, members: ["a2"] }],
    configured: { id: "staff", members: ["k2", "s1"] },
    memberFetch: "throw",
  });
  assert.equal(await contactAdminServer(client, fakeInteraction(trace, client, { server: "g9", message: "Bonjour" })), true);
  assert.deepEqual(trace, [
    DEFER, "guilds.fetch g9", "members.fetch *",
    "log Failed to read admin role members on guild 'g9' (role 'admin'), cache used : Members didn't arrive in time.",
    "roles.fetch staff",
    "dm:k1 Bonjour", "dm:k2 Bonjour",
    "editReply Message successfully sent to 2 admin(s) !\nWarning: Discord did not let the bot read every admin role, " +
      "so some admins may not have received it. Please try again later if needed.",
  ]);
});

test("membres illisibles en appel interne, aucun connu : journalisé, le propriétaire prévenu", async () => {
  await setAdminRole("g9", null);
  const trace: string[] = [];
  const client = fakeClient(trace, { roles: [{ id: "admin", admin: true, members: ["a1"] }], memberFetch: "throw" });
  assert.equal(await contactAdminServer(client, undefined, "g9", "Alerte"), true);
  assert.deepEqual(trace, [
    "guilds.fetch g9", "members.fetch *",
    "log Failed to read admin role members on guild 'g9' (role 'admin'), cache used : Members didn't arrive in time.",
    "users.fetch proprio", "dm:proprio Alerte",
  ]);
});

test("message absent : refus en réponse, ou au journal en appel interne", async () => {
  await setAdminRole("g1", null);
  const trace: string[] = [];
  const client = fakeClient(trace, { roles: [{ id: "admin", admin: true, members: ["a1"] }] });
  assert.equal(await contactAdminServer(client, fakeInteraction(trace, client, { server: "g1", message: null })), false);
  assert.equal(await contactAdminServer(client, undefined, "g1", ""), false);
  assert.deepEqual(trace, [
    DEFER, "guilds.fetch g1", "reply (éphémère) Parameter 'message' not found. Please try again.",
    "guilds.fetch g1", "log Parameter 'message' not found. Please try again.",
  ]);
});

test("un administrateur aux MP fermés : journalisé par identifiant, l'envoi reste un succès", async () => {
  await setAdminRole("g1", null);
  const trace: string[] = [];
  const client = fakeClient(trace, { roles: [{ id: "admin", admin: true, members: ["a1", "a2"] }], closedDms: ["a1"] });
  assert.equal(await contactAdminServer(client, fakeInteraction(trace, client, { server: "g1", message: "Salut" })), true);
  assert.deepEqual(trace, [
    DEFER, "guilds.fetch g1",
    "log SafeUser failed : Cannot send messages to this user",
    "dm:a2 Salut",
    "log Erreur pour l'envoies au admins : \nEchec de l'envoi pour le compte a1\n",
    "editReply Message successfully sent to 2 admin(s) !",
  ]);
});

test("ferme la base à la fin de la suite", async () => {
  assert.equal(await resetBddInstance(), true);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
