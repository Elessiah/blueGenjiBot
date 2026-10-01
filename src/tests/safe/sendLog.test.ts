import test from "node:test";
import assert from "node:assert/strict";

process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { sendLog } from "../../safe/sendLog.js";
import type { idSendLogMsg } from "../../safe/types.js";
import type { Client } from "discord.js";

/**
 * Caractérisation de `sendLog` : la trace ordonnée des appels Discord (lecture
 * du titulaire, copie privée, lecture et envoi au salon de supervision), les
 * lignes écrites sur la console et la valeur rendue, pour chaque panne possible.
 */

type Setup = {
  /** Lectures du titulaire qui échouent avant la première réussite (`Infinity` : toujours). */
  ownerFetchFailures?: number;
  /** Copies privées au titulaire qui échouent avant la première réussite. */
  ownerSendFailures?: number;
  /** Le salon de supervision : absent, illisible, ou qui refuse l'envoi. */
  channel?: "ok" | "null" | "fetch-throws" | "missing-access" | "send-throws";
  /** L'avis « Missing Access » au titulaire échoue lui aussi. */
  ownerNoticeFails?: boolean;
};

function fakeClient(trace: string[], setup: Setup): Client {
  let ownerFetches = 0;
  let ownerSends = 0;
  const owner = {
    id: "owner-1",
    send: async (text: string) => {
      ownerSends++;
      if (ownerSends <= (setup.ownerSendFailures ?? 0)) {
        trace.push("owner.send échoue");
        throw new Error("DM fermés");
      }
      if (text === "Missing Access to admin channel" && setup.ownerNoticeFails) {
        trace.push("owner.send échoue");
        throw new Error("DM fermés");
      }
      trace.push("owner.send " + text);
      return { id: "owner-msg-" + ownerSends };
    },
  };
  return {
    users: {
      fetch: async (id: string) => {
        ownerFetches++;
        trace.push("users.fetch " + id);
        if (ownerFetches <= (setup.ownerFetchFailures ?? 0)) throw new Error("Gateway indisponible");
        return owner;
      },
    },
    channels: {
      fetch: async (id: string) => {
        trace.push("channels.fetch " + id);
        const mode = setup.channel ?? "ok";
        if (mode === "null") return null;
        if (mode === "fetch-throws") throw new Error("Unknown Channel");
        return {
          send: async (text: string) => {
            if (mode === "missing-access") throw Object.assign(new Error("Missing Access"), { code: 50001 });
            if (mode === "send-throws") throw Object.assign(new Error("Rate limited"), { code: 429 });
            trace.push("admin.send " + text);
            return { id: "admin-msg" };
          },
        };
      },
    },
  } as unknown as Client;
}

async function run(setup: Setup, args: { message?: string; idMsg?: idSendLogMsg; copyToOwner?: boolean } = {}) {
  const trace: string[] = [];
  const errors: string[] = [];
  const original = console.error;
  console.error = (...parts: unknown[]) => { errors.push(parts.map(String).join(" ")); };
  try {
    const ok = await sendLog(fakeClient(trace, setup), args.message, args.idMsg, args.copyToOwner);
    return { ok, trace, errors };
  } finally {
    console.error = original;
  }
}

test("par défaut : salon de supervision seul, sans copie au titulaire", async () => {
  const r = await run({}, { message: "Bonjour" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.trace, ["users.fetch owner-1", "channels.fetch admin-channel-1", "admin.send Bonjour"]);
  assert.deepEqual(r.errors, []);
});

test("sans texte : « Error » est journalisé", async () => {
  const r = await run({});
  assert.deepEqual(r.trace.at(-1), "admin.send Error");
});

test("avec idMsg : copie au titulaire puis salon, les deux identifiants rendus", async () => {
  const idMsg: idSendLogMsg = { owner: "", admin: "" };
  const r = await run({}, { message: "Exclusion", idMsg });
  assert.equal(r.ok, true);
  assert.deepEqual(r.trace, ["users.fetch owner-1", "owner.send Exclusion", "channels.fetch admin-channel-1", "admin.send Exclusion"]);
  assert.deepEqual(idMsg, { owner: "owner-msg-1", admin: "admin-msg" });
});

test("copie forcée sans idMsg, ou idMsg sans copie", async () => {
  const forced = await run({}, { message: "A", copyToOwner: true });
  assert.deepEqual(forced.trace, ["users.fetch owner-1", "owner.send A", "channels.fetch admin-channel-1", "admin.send A"]);
  const idMsg: idSendLogMsg = { owner: "", admin: "" };
  const noCopy = await run({}, { message: "B", idMsg, copyToOwner: false });
  assert.deepEqual(noCopy.trace, ["users.fetch owner-1", "channels.fetch admin-channel-1", "admin.send B"]);
  assert.deepEqual(idMsg, { owner: "", admin: "admin-msg" });
});

test("salon de supervision absent : échec immédiat, sans nouvel essai", async () => {
  const r = await run({ channel: "null" }, { message: "X" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.trace, ["users.fetch owner-1", "channels.fetch admin-channel-1"]);
});

test("accès refusé au salon : le titulaire est prévenu, l'envoi compte comme fait", async () => {
  const r = await run({ channel: "missing-access" }, { message: "X" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.trace, ["users.fetch owner-1", "channels.fetch admin-channel-1", "owner.send Missing Access to admin channel"]);
  assert.deepEqual(r.errors, []);
});

test("accès refusé et titulaire injoignable : avalé, toujours un succès", async () => {
  const r = await run({ channel: "missing-access", ownerNoticeFails: true }, { message: "X" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.trace, ["users.fetch owner-1", "channels.fetch admin-channel-1", "owner.send échoue"]);
});

test("autre échec du salon (lecture ou envoi) : silencieux, un succès", async () => {
  for (const channel of ["fetch-throws", "send-throws"] as const) {
    const r = await run({ channel }, { message: "X" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.trace, ["users.fetch owner-1", "channels.fetch admin-channel-1"]);
    assert.deepEqual(r.errors, []);
  }
});

test("titulaire illisible trois fois : trois lignes à la console, échec", async () => {
  const r = await run({ ownerFetchFailures: Infinity }, { message: "X" });
  assert.equal(r.ok, false);
  assert.deepEqual(r.trace, ["users.fetch owner-1", "users.fetch owner-1", "users.fetch owner-1"]);
  assert.deepEqual(r.errors, Array(3).fill("Erreur while sending to the owner :  Gateway indisponible"));
});

test("titulaire illisible une fois : second essai complet", async () => {
  const r = await run({ ownerFetchFailures: 1 }, { message: "X" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.trace, ["users.fetch owner-1", "users.fetch owner-1", "channels.fetch admin-channel-1", "admin.send X"]);
  assert.equal(r.errors.length, 1);
});

test("copie au titulaire refusée : tout l'essai est rejoué", async () => {
  const idMsg: idSendLogMsg = { owner: "", admin: "" };
  const r = await run({ ownerSendFailures: 2 }, { message: "X", idMsg });
  assert.equal(r.ok, true);
  assert.deepEqual(r.trace, [
    "users.fetch owner-1", "owner.send échoue",
    "users.fetch owner-1", "owner.send échoue",
    "users.fetch owner-1", "owner.send X", "channels.fetch admin-channel-1", "admin.send X",
  ]);
  assert.deepEqual(r.errors, Array(2).fill("Erreur while sending to the owner :  DM fermés"));
  assert.deepEqual(idMsg, { owner: "owner-msg-3", admin: "admin-msg" });
});

test("copie au titulaire refusée trois fois : le salon n'est jamais servi", async () => {
  const r = await run({ ownerSendFailures: 3 }, { message: "X", copyToOwner: true });
  assert.equal(r.ok, false);
  assert.ok(!r.trace.some((line) => line.startsWith("channels.fetch")));
});
