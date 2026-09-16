import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

// Meme montage que `tests/bdd/rawMethod.test.ts` : une base jetable, designee
// **avant** l'import du module, puisque le singleton l'ouvre a son premier appel.
const TMP_DB = path.join(os.tmpdir(), `bgenji-ban-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";
import { checkBan } from "../../check/checkBan.js";
import type { Client } from "discord.js";

/** Ce que le faux client a recu, pour distinguer « pas appele » de « a echoue ». */
type Trace = { dms: string[]; logs: string[] };

/**
 * Faux client Discord.
 *
 * `failing` nomme l'appel qui doit lever, ce qui est tout l'objet de ces tests :
 * chacune de ces trois lectures echoue en exploitation ordinaire (compte
 * supprime, `INFO_SERV` mal renseigne, message de motif efface), et chacune
 * rendait autrefois « pas banni ».
 */
function fakeClient(
  failing: "none" | "user" | "channel" | "message",
  trace: Trace,
): Client {
  // `safeUser` envoie `{ content, files }`, `sendLog` une chaine nue : on
  // enregistre le texte dans les deux cas.
  const sendTo = (bucket: string[]) => async (payload: unknown) => {
    const text = typeof payload === "string"
      ? payload
      : String((payload as { content?: unknown })?.content ?? "");
    bucket.push(text);
    return { id: `msg-${bucket.length}` };
  };
  return {
    users: {
      fetch: async (id: string) => {
        // `sendLog` passe par ici aussi : seul le banni doit pouvoir echouer.
        if (failing === "user" && id !== process.env.OWNER_ID) {
          throw new Error("Unknown User");
        }
        return { id, send: sendTo(id === process.env.OWNER_ID ? trace.logs : trace.dms) };
      },
    },
    channels: {
      fetch: async () => {
        if (failing === "channel") throw new Error("Unknown Channel");
        return {
          send: sendTo(trace.logs),
          messages: {
            fetch: async () => {
              if (failing === "message") throw new Error("Unknown Message");
              return { content: "Spam repete" };
            },
          },
        };
      },
    },
  } as unknown as Client;
}

function newTrace(): Trace {
  return { dms: [], logs: [] };
}

async function seedBan(idUser: string): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.set("Ban", ["id_user", "id_moderator", "id_reason"], [idUser, "mod-1", "reason-msg-1"]);
}

test("rend NOT_BANNED quand aucune ligne ne vise le compte", async () => {
  const verdict = await checkBan(fakeClient("none", newTrace()), "libre-1", false);
  assert.equal(verdict, "NOT_BANNED");
});

test("rend BANNED sans rien notifier quand alertUser est false", async () => {
  const trace = newTrace();
  await seedBan("banni-1");
  const verdict = await checkBan(fakeClient("none", trace), "banni-1", false);
  assert.equal(verdict, "BANNED");
  assert.deepEqual(trace.dms, []);
});

test("notifie le banni avec le motif relu au salon d'administration", async () => {
  const trace = newTrace();
  await seedBan("banni-2");
  const verdict = await checkBan(fakeClient("none", trace), "banni-2");
  assert.equal(verdict, "BANNED");
  assert.equal(trace.dms.length, 1);
  assert.match(trace.dms[0], /Spam repete/);
});

// --- Le defaut corrige : la notification ne decide pas du bannissement. ---

test("reste BANNED quand le message de motif a ete efface", async () => {
  // Le cas le plus atteignable des trois : un menage dans le salon
  // d'administration levait les bannissements qu'on venait d'y motiver.
  const trace = newTrace();
  await seedBan("banni-3");
  const verdict = await checkBan(fakeClient("message", trace), "banni-3");
  assert.equal(verdict, "BANNED");
  assert.deepEqual(trace.dms, []);
});

test("reste BANNED quand le compte du banni n'existe plus", async () => {
  const trace = newTrace();
  await seedBan("banni-4");
  const verdict = await checkBan(fakeClient("user", trace), "banni-4");
  assert.equal(verdict, "BANNED");
});

test("reste BANNED quand le salon d'administration est injoignable", async () => {
  const trace = newTrace();
  await seedBan("banni-5");
  const verdict = await checkBan(fakeClient("channel", trace), "banni-5");
  assert.equal(verdict, "BANNED");
});

// --- Le second etat : « on n'a pas pu savoir » n'est pas « pas banni ». ---

test("rend UNKNOWN quand la lecture du verdict echoue", async () => {
  // La table disparait : proxy de la fenetre reelle ou la base est
  // indisponible (verrou de la sauvegarde nocturne, fichier deplace).
  // Ce test passe en dernier -- il abime la base a dessein.
  const bdd = await getBddInstance();
  await bdd.raw("DROP TABLE Ban", []);
  const verdict = await checkBan(fakeClient("none", newTrace()), "banni-1", false);
  assert.equal(verdict, "UNKNOWN");
});

test.after(async () => {
  closeBddInstance();
  await new Promise((resolve) => setTimeout(resolve, 100));
  try { fs.unlinkSync(TMP_DB); } catch { /* deja parti */ }
});
