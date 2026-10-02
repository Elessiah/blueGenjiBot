import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { ChatInputCommandInteraction, Client, User } from "discord.js";

const TMP_DIR = path.join(os.tmpdir(), `bgenji-ban-${randomUUID()}`);
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "900000000000000001";
process.env.INFO_SERV = "800000000000000001";
process.env.SERV_GENJI = "700000000000000001";
process.env.SERV_RIVALS = "700000000000000002";

import { ban } from "../../commandsHandlers/ban/ban.js";
import { closeBddInstance, getBddInstance } from "../../bdd/Bdd.js";

/**
 * `/ban` : préconditions (serveur, taille, droits), verdict déjà banni ou
 * indisponible, écriture de l'exclusion avec les identifiants des messages
 * du journal, effacement des relais du joueur, et retrait des messages
 * publiés quand l'écriture échoue.
 */

const OWNER = process.env.OWNER_ID as string;
const TARGET = "500000000000000001";
const MODERATOR = "400000000000000001";

type World = { replies: string[]; logs: string[]; ownerDms: string[]; trace: string[] };

function fakeClient(world: World): Client {
  let next = 0;
  return {
    users: {
      fetch: async (id: string) => ({
        id,
        send: async (text: string) => { world.ownerDms.push(text); return { id: `owner-msg-${++next}` }; },
        createDM: async () => ({ messages: { delete: async (msgId: string) => { world.trace.push(`dm-delete ${msgId}`); } } }),
      }),
    },
    channels: {
      fetch: async (id: string) => {
        if (id === process.env.INFO_SERV) {
          return {
            send: async (text: string) => { world.logs.push(text); return { id: `admin-msg-${++next}` }; },
            messages: { delete: async (msgId: string) => { world.trace.push(`admin-delete ${msgId}`); } },
          };
        }
        return {
          messages: {
            fetch: async (msgId: string) => ({ delete: async () => { world.trace.push(`relay-delete ${id}/${msgId}`); } }),
          },
        };
      },
    },
  } as unknown as Client;
}

type Setup = { guild?: { id: string; memberCount: number } | null; memberId?: string };

function run(setup: Setup = {}): { world: World; call: () => Promise<boolean> } {
  const world: World = { replies: [], logs: [], ownerDms: [], trace: [] };
  const client = fakeClient(world);
  const memberId = setup.memberId ?? OWNER;
  const guild = setup.guild === undefined ? { id: "600000000000000001", memberCount: 80 } : setup.guild;
  const interaction = {
    client,
    deferReply: async () => {},
    editReply: async ({ content }: { content: string }) => { world.replies.push(content); },
    guild: guild && { ...guild, members: { cache: new Map() } },
    user: { id: memberId },
    member: { id: memberId },
    channel: {},
  } as unknown as ChatInputCommandInteraction;
  const target = { id: TARGET } as User;
  return { world, call: () => ban(client, interaction, target, "triche avérée") };
}

async function sql<T = unknown>(query: string, values: unknown[] = []): Promise<T[]> {
  const bdd = await getBddInstance();
  return bdd.raw<T>(query, values);
}

test.beforeEach(async () => {
  await sql("DELETE FROM Ban");
  await sql("DELETE FROM OGMsg");
  await sql("DELETE FROM DPMsg");
  await sql("DROP TRIGGER IF EXISTS refuse_ban");
});

test.after(async () => {
  await closeBddInstance();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

test("hors serveur : refus sans rien écrire", async () => {
  const { world, call } = run({ guild: null });
  assert.equal(await call(), false);
  assert.match(world.replies[0], /Guild was not into the interaction/);
  assert.deepEqual(await sql("SELECT * FROM Ban"), []);
});

test("serveur de moins de 50 membres : refus, sauf serveurs BlueGenji", async () => {
  let { world, call } = run({ guild: { id: "600000000000000009", memberCount: 49 } });
  assert.equal(await call(), false);
  assert.match(world.replies[0], /^Your server doesn't have enough members/);

  for (const id of [process.env.SERV_GENJI as string, process.env.SERV_RIVALS as string]) {
    await sql("DELETE FROM Ban");
    ({ world, call } = run({ guild: { id, memberCount: 3 } }));
    assert.equal(await call(), true, `serveur ${id}`);
    assert.deepEqual(world.replies, ["Member has been successfully banned !"]);
  }
});

test("sans droit de modération : refus sans rien écrire", async () => {
  const { world, call } = run({ memberId: MODERATOR });
  assert.equal(await call(), false);
  assert.match(world.replies[0], /^You don't have permission to ban users/);
  assert.deepEqual(await sql("SELECT * FROM Ban"), []);
  assert.deepEqual(world.logs, []);
});

test("joueur déjà banni : rien de republié, succès", async () => {
  await sql("INSERT INTO Ban (id_user, id_moderator, id_reason) VALUES (?, 'm', 'r')", [TARGET]);
  const { world, call } = run();
  assert.equal(await call(), true);
  assert.deepEqual(world.replies, ["This user has been already banned."]);
  assert.deepEqual(world.logs, []);
});

test("exclusion : avis et motif au journal sans pseudo, identifiants gardés, relais effacés", async () => {
  await sql("INSERT INTO OGMsg (id_msg, id_author) VALUES ('og-1', ?), ('og-2', 'autre')", [TARGET]);
  await sql("INSERT INTO DPMsg (id_msg, id_channel, id_og) VALUES ('dp-1', 'chan-a', 'og-1'), ('dp-2', 'chan-b', 'og-1'), ('dp-3', 'chan-c', 'og-2')");
  const { world, call } = run();
  assert.equal(await call(), true);

  assert.deepEqual(world.logs, [
    `*Un joueur (id ${TARGET}) a été exclu par un modérateur (id ${OWNER}).*`,
    "**Reason:** triche avérée",
  ]);
  assert.deepEqual(world.ownerDms, ["**Reason:** triche avérée"], "l'avis ne part qu'au salon, le motif aussi au propriétaire");
  const [row] = await sql<Record<string, string | null>>("SELECT id_user, id_moderator, id_reason, id_reason_owner, id_notice_admin FROM Ban");
  assert.deepEqual(row, {
    id_user: TARGET,
    id_moderator: OWNER,
    id_reason: "admin-msg-3",
    id_reason_owner: "owner-msg-2",
    id_notice_admin: "admin-msg-1",
  });
  assert.deepEqual(world.trace.sort(), ["relay-delete chan-a/dp-1", "relay-delete chan-b/dp-2"], "seuls les relais du joueur");
  assert.deepEqual(world.replies, ["Member has been successfully banned !"]);
});

test("écriture refusée : messages publiés retirés, échec annoncé", async () => {
  await sql("CREATE TRIGGER refuse_ban BEFORE INSERT ON Ban BEGIN SELECT RAISE(ABORT, 'base verrouillee'); END");
  const { world, call } = run();
  assert.equal(await call(), false);
  assert.deepEqual(await sql("SELECT * FROM Ban"), []);
  assert.deepEqual(world.trace.sort(), ["admin-delete admin-msg-1", "admin-delete admin-msg-3", "dm-delete owner-msg-2"]);
  assert.match(world.logs[world.logs.length - 1], /^Error while register ban : .*base verrouillee/);
  assert.deepEqual(world.replies, ["Ban could not be recorded, please try again in a moment."]);
});

test("verdict indisponible (base fermée) : refus sans rien publier", async () => {
  await closeBddInstance();
  const { world, call } = run();
  assert.equal(await call(), false);
  assert.deepEqual(world.replies, ["Ban database unreachable, please try again in a moment."]);
  assert.ok(world.logs.every((l) => !l.startsWith("*Un joueur")), "aucun avis d'exclusion");
  assert.ok(world.logs.some((l) => l.startsWith("Failed to check ban : ")));
});
