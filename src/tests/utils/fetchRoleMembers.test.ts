import test from "node:test";
import assert from "node:assert/strict";
import type { Guild, GuildMember, Role } from "discord.js";
import { fetchRoleMembers } from "../../utils/fetchRoleMembers.js";

/**
 * Faux serveur : `cached` membres déjà en cache sur `memberCount`, et le rôle
 * lit ce qui est en cache au moment de l'appel.
 */
function setup(opts: { cached: number; memberCount?: number; fails?: boolean }) {
  const cache = new Map<string, GuildMember>();
  const fill = (n: number) => { for (let i = 0; i < n; i++) cache.set("m" + i, { id: "m" + i } as unknown as GuildMember); };
  fill(opts.cached);
  let fetches = 0;
  const guild = {
    id: "guild-1",
    memberCount: opts.memberCount,
    members: {
      cache,
      fetch: async () => {
        fetches++;
        await new Promise((resolve) => setImmediate(resolve));
        if (opts.fails) throw new Error("Members didn't arrive in time.");
        fill(opts.memberCount ?? 3);
      },
    },
  } as unknown as Guild;
  const role = { members: { values: () => cache.values() } } as unknown as Role;
  return { guild, role, fetches: () => fetches };
}

test("cache incomplet : le serveur est récupéré avant de lire le rôle", async () => {
  const s = setup({ cached: 0, memberCount: 3 });
  const members = await fetchRoleMembers(s.guild, s.role);
  assert.equal(s.fetches(), 1);
  assert.deepEqual(members.map((m) => m.id), ["m0", "m1", "m2"]);
});

test("cache complet : aucune récupération, le cache suffit", async () => {
  const s = setup({ cached: 2, memberCount: 2 });
  const members = await fetchRoleMembers(s.guild, s.role);
  assert.equal(s.fetches(), 0);
  assert.equal(members.length, 2);
});

test("nombre de membres inconnu : la récupération est demandée", async () => {
  const s = setup({ cached: 1 });
  await fetchRoleMembers(s.guild, s.role);
  assert.equal(s.fetches(), 1);
});

test("récupération en échec : l'erreur remonte à l'appelant", async () => {
  const s = setup({ cached: 0, memberCount: 3, fails: true });
  await assert.rejects(fetchRoleMembers(s.guild, s.role), /arrive in time/);
});

test("lectures simultanées d'un même serveur : une seule récupération partagée", async () => {
  const s = setup({ cached: 0, memberCount: 3 });
  const [a, b] = await Promise.all([fetchRoleMembers(s.guild, s.role), fetchRoleMembers(s.guild, s.role)]);
  assert.equal(s.fetches(), 1);
  assert.equal(a.length, 3);
  assert.equal(b.length, 3);
});

test("après un échec partagé, la lecture suivante retente la récupération", async () => {
  const s = setup({ cached: 0, memberCount: 3, fails: true });
  await assert.rejects(fetchRoleMembers(s.guild, s.role));
  await assert.rejects(fetchRoleMembers(s.guild, s.role));
  assert.equal(s.fetches(), 2);
});
