import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Base jetable désignée avant l'import : le rôle arbitre se lit dans RefereeRole.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-referees-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, resetBddInstance } from "../../bdd/Bdd.js";
import { alertReferees } from "../../notifications/deliver.js";
import { MAX_REFEREE_DMS } from "../../notifications/notifications.js";
import type { Client } from "discord.js";

/**
 * Caractérisation de `alertReferees` : bilan rendu et trace ordonnée (journal,
 * lectures de rôles et de membres, messages privés), serveur par serveur.
 */

type FakeMember = { id: string; bot?: boolean; closed?: boolean };
type FakeGuild = {
  id: string;
  name: string;
  /** Le rôle configuré : ses membres, `null` = introuvable, `"throw"` = illisible. */
  role?: FakeMember[] | null | "throw";
  /** La récupération de tous les membres échoue. */
  membersFetchFails?: boolean;
};

function fakeClient(trace: string[], guilds: FakeGuild[]): Client {
  const cache = new Map(guilds.map((g) => [g.id, {
    id: g.id,
    name: g.name,
    roles: {
      fetch: async (roleId: string) => {
        trace.push(`roles.fetch ${g.id}/${roleId}`);
        if (g.role === "throw") throw new Error("Missing Access");
        if (g.role === null || g.role === undefined) return null;
        const members = g.role;
        return {
          members: new Map(members.map((m) => [m.id, {
            id: m.id,
            user: { bot: Boolean(m.bot), username: "pseudo-" + m.id },
            send: async (text: string) => {
              if (m.closed) throw new Error("Cannot send messages to this user");
              trace.push(`dm:${m.id} ${text}`);
            },
          }])),
        };
      },
    },
    members: {
      fetch: async () => {
        trace.push("members.fetch " + g.id);
        if (g.membersFetchFails) throw new Error("Timeout");
      },
    },
  }]));
  return {
    users: { fetch: async (id: string) => ({ id, send: async () => ({ id: "dm" }) }) },
    channels: { fetch: async () => ({ send: async (text: string) => { trace.push("log " + text); return { id: "log" }; } }) },
    guilds: { cache },
  } as unknown as Client;
}

async function clearRefereeRoles(): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM RefereeRole", []);
}

async function setRefereeRole(guildId: string, roleId: string): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw("INSERT OR REPLACE INTO RefereeRole (id_guild, id_role) VALUES (?, ?)", [guildId, roleId]);
}

test("journal d'abord, puis chaque arbitre humain du rôle, un seul message par personne", async () => {
  await setRefereeRole("g1", "arb1");
  await setRefereeRole("g2", "arb2");
  const trace: string[] = [];
  const report = await alertReferees(fakeClient(trace, [
    { id: "g1", name: "Genji", role: [{ id: "a" }, { id: "bot", bot: true }, { id: "b" }] },
    { id: "g0", name: "Sans rôle", role: [{ id: "z" }] },
    { id: "g2", name: "Rivals", role: [{ id: "b" }, { id: "c" }] },
  ]), "Problème match 4");
  assert.deepEqual(report, { sent: 3, unresolved: [], failed: [] });
  assert.deepEqual(trace, [
    "log Problème match 4",
    "roles.fetch g1/arb1", "members.fetch g1", "dm:a Problème match 4", "dm:b Problème match 4",
    "roles.fetch g2/arb2", "members.fetch g2", "dm:c Problème match 4",
  ]);
});

test("rôle introuvable ou illisible, membres illisibles : noté par serveur, les autres servis", async () => {
  for (const g of ["g1", "g2", "g3", "g4"]) await setRefereeRole(g, "arb-" + g);
  const trace: string[] = [];
  const report = await alertReferees(fakeClient(trace, [
    { id: "g1", name: "Un", role: null },
    { id: "g2", name: "Deux", role: "throw" },
    { id: "g3", name: "Trois", role: [{ id: "x" }], membersFetchFails: true },
    { id: "g4", name: "Quatre", role: [{ id: "y", closed: true }, { id: "w" }] },
  ]), "Alerte");
  assert.deepEqual(report, {
    sent: 1,
    unresolved: ["Un: rôle arb-g1 introuvable", "Deux: membres du rôle illisibles", "Trois: membres du rôle illisibles"],
    failed: ["pseudo-y"],
  });
  assert.deepEqual(trace, [
    "log Alerte",
    "roles.fetch g1/arb-g1",
    "roles.fetch g2/arb-g2",
    "roles.fetch g3/arb-g3", "members.fetch g3",
    "roles.fetch g4/arb-g4", "members.fetch g4", "dm:w Alerte",
  ]);
});

test("rôle trop large : plafonné, les écartés comptés et journalisés", async () => {
  await clearRefereeRoles();
  await setRefereeRole("g1", "arb");
  const members = Array.from({ length: MAX_REFEREE_DMS + 3 }, (_, i) => ({ id: "m" + i }));
  const trace: string[] = [];
  const report = await alertReferees(fakeClient(trace, [{ id: "g1", name: "Large", role: [{ id: "robot", bot: true }, ...members] }]), "Vite");
  assert.equal(report.sent, MAX_REFEREE_DMS);
  assert.deepEqual(report.unresolved, [`Large: 3 membre(s) au-delà du plafond de ${MAX_REFEREE_DMS}`]);
  assert.deepEqual(trace.slice(0, 4), [
    "log Vite",
    "roles.fetch g1/arb", "members.fetch g1",
    `log notify/referees: role arbitre de Large trop large (${MAX_REFEREE_DMS + 3} membres), 3 non prevenu(s).`,
  ]);
  assert.deepEqual(trace.slice(4), members.slice(0, MAX_REFEREE_DMS).map((m) => `dm:${m.id} Vite`));
});

test("aucun rôle configuré : journal seul", async () => {
  await clearRefereeRoles();
  const trace: string[] = [];
  assert.deepEqual(await alertReferees(fakeClient(trace, [{ id: "g1", name: "Un", role: [{ id: "a" }] }]), "Rien"), { sent: 0, unresolved: [], failed: [] });
  assert.deepEqual(trace, ["log Rien"]);
});

test("ferme la base à la fin de la suite", async () => {
  assert.equal(await resetBddInstance(), true);
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
