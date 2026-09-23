import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

// `deliver.ts` importe le singleton de base : on le dirige vers un fichier
// jetable **avant** l'import, comme les autres tests qui le touchent.
process.env.BDD_PATH = path.join(os.tmpdir(), `bgenji-deliver-${randomUUID()}.sqlite`);
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { deliverDirectMessages, HomeGuildUnavailableError } from "../../notifications/deliver.js";
import type { Client } from "discord.js";

const GENJI = "111111111111111111";
const RIVALS = "222222222222222222";

type Trace = { dms: string[]; logs: string[] };

/**
 * Faux client : `guilds` associe chaque serveur joignable à ses membres (par
 * identifiant). Un serveur absent de la table lève, comme Discord pour un
 * serveur quitté ou un identifiant faux.
 */
function fakeClient(guilds: Record<string, string[]>, trace: Trace, closedDms: string[] = []): Client {
  const log = async (text: unknown) => { trace.logs.push(String(text)); return { id: "log" }; };
  return {
    users: { fetch: async () => ({ send: log }) },
    channels: { fetch: async () => ({ send: log }) },
    guilds: {
      fetch: async (id: string) => {
        const members = guilds[id];
        if (!members) throw new Error("Unknown Guild");
        return {
          id,
          members: {
            fetch: async (memberId: string) => {
              if (!members.includes(memberId)) throw new Error("Unknown Member");
              return {
                id: memberId,
                send: async (message: string) => {
                  if (closedDms.includes(memberId)) throw new Error("Cannot send messages to this user");
                  trace.dms.push(`${memberId}:${message}`);
                },
              };
            },
          },
        };
      },
    },
  } as unknown as Client;
}

function withEnv(env: Record<string, string | undefined>, run: () => Promise<void>) {
  const saved = { GUILD_ID: process.env.GUILD_ID, SERV_GENJI: process.env.SERV_GENJI, SERV_RIVALS: process.env.SERV_RIVALS };
  Object.assign(process.env, { GUILD_ID: "", SERV_GENJI: "", SERV_RIVALS: "" }, env);
  return run().finally(() => Object.assign(process.env, saved));
}

const recipient = (discordId: string, label = discordId) => ({ discordId, handle: null, label });

test("sans GUILD_ID, écrit aux membres des serveurs BlueGenji (SERV_GENJI / SERV_RIVALS)", () =>
  withEnv({ SERV_GENJI: GENJI, SERV_RIVALS: RIVALS }, async () => {
    const trace: Trace = { dms: [], logs: [] };
    const client = fakeClient({ [GENJI]: ["900000000000000001"], [RIVALS]: ["900000000000000002"] }, trace);
    const report = await deliverDirectMessages(client, "Bonjour", [
      recipient("900000000000000001", "Genji"),
      recipient("900000000000000002", "Rivals"),
      recipient("900000000000000003", "Absent"),
    ]);
    // Le joueur du seul serveur Rivals est joint : il est membre de BlueGenji.
    assert.deepEqual(report, { sent: 2, unresolved: ["Absent"], failed: [] });
    assert.equal(trace.dms.length, 2);
  }));

test("un serveur injoignable n'empêche pas d'écrire via l'autre", () =>
  withEnv({ SERV_GENJI: GENJI, SERV_RIVALS: RIVALS }, async () => {
    const trace: Trace = { dms: [], logs: [] };
    const client = fakeClient({ [RIVALS]: ["900000000000000002"] }, trace);
    const report = await deliverDirectMessages(client, "Bonjour", [recipient("900000000000000002")]);
    assert.equal(report.sent, 1);
  }));

test("aucun serveur joignable : lève au lieu de déclarer tout le monde introuvable", () =>
  withEnv({}, async () => {
    const trace: Trace = { dms: [], logs: [] };
    const client = fakeClient({ [GENJI]: ["900000000000000001"] }, trace);
    await assert.rejects(
      deliverDirectMessages(client, "Bonjour", [recipient("900000000000000001")]),
      HomeGuildUnavailableError,
    );
    assert.equal(trace.dms.length, 0);
    assert.ok(trace.logs.some((line) => line.includes("aucun serveur BlueGenji joignable")));
  }));

test("serveurs configurés mais tous injoignables : lève aussi", () =>
  withEnv({ SERV_GENJI: GENJI }, async () => {
    const trace: Trace = { dms: [], logs: [] };
    await assert.rejects(
      deliverDirectMessages(fakeClient({}, trace), "Bonjour", [recipient("900000000000000001")]),
      HomeGuildUnavailableError,
    );
  }));

test("GUILD_ID reste la surcharge explicite", () =>
  withEnv({ GUILD_ID: RIVALS, SERV_GENJI: GENJI }, async () => {
    const trace: Trace = { dms: [], logs: [] };
    const client = fakeClient({ [GENJI]: ["900000000000000001"], [RIVALS]: [] }, trace);
    const report = await deliverDirectMessages(client, "Bonjour", [recipient("900000000000000001", "Genji")]);
    // Seul le serveur désigné compte : le membre de GENJI n'est pas cherché là.
    assert.deepEqual(report, { sent: 0, unresolved: ["Genji"], failed: [] });
  }));

test("messages privés fermés : compté en échec, pas en introuvable", () =>
  withEnv({ SERV_GENJI: GENJI }, async () => {
    const trace: Trace = { dms: [], logs: [] };
    const client = fakeClient({ [GENJI]: ["900000000000000001"] }, trace, ["900000000000000001"]);
    const report = await deliverDirectMessages(client, "Bonjour", [recipient("900000000000000001", "Ferme")]);
    assert.deepEqual(report, { sent: 0, unresolved: [], failed: ["Ferme"] });
  }));
