import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Client } from "discord.js";

import { installProcessGuards, reportError, _resetProcessGuards } from "../../safe/processGuards.js";

process.env.OWNER_ID = "owner-test";
process.env.INFO_SERV = "info-test";

/** Écouteurs process déjà en place avant l'installation, pour ne retirer que les nôtres. */
const BEFORE = {
  unhandledRejection: process.listeners("unhandledRejection").slice(),
  uncaughtException: process.listeners("uncaughtException").slice(),
};

/**
 * Construit un émetteur d'événements qui tient lieu de client Discord.
 * @returns Le faux client et les lignes envoyées au canal de supervision.
 */
function fakeClient(): { client: Client & EventEmitter; sentLogs: string[] } {
  const sentLogs: string[] = [];
  const emitter = new EventEmitter() as EventEmitter & {
    users: unknown;
    channels: unknown;
  };
  emitter.users = { fetch: async () => ({ send: async () => ({ id: "owner-msg" }) }) };
  emitter.channels = {
    fetch: async () => ({
      send: async (content: string) => {
        sentLogs.push(content);
        return { id: "admin-msg" };
      },
    }),
  };
  return { client: emitter as unknown as Client & EventEmitter, sentLogs };
}

test("installProcessGuards branche les garde-fous process et client", () => {
  _resetProcessGuards();
  const { client } = fakeClient();

  installProcessGuards(client);

  assert.ok(process.listenerCount("unhandledRejection") > BEFORE.unhandledRejection.length);
  assert.ok(process.listenerCount("uncaughtException") > BEFORE.uncaughtException.length);
  assert.equal(client.listenerCount("error"), 1);
  assert.equal(client.listenerCount("shardError"), 1);
});

test("installProcessGuards est idempotent : deux appels n'empilent pas les ecouteurs", () => {
  const before = process.listenerCount("unhandledRejection");
  const { client } = fakeClient();

  installProcessGuards(client);
  installProcessGuards(client);

  assert.equal(process.listenerCount("unhandledRejection"), before);
  // Le second client, arrive apres l'installation, n'est pas rebranche.
  assert.equal(client.listenerCount("error"), 0);
});

test("un evenement 'error' du client ne fait plus remonter d'exception", () => {
  _resetProcessGuards();
  const { client } = fakeClient();
  installProcessGuards(client);

  // Sans ecouteur 'error', un EventEmitter relance l'erreur : c'est le
  // mecanisme qui transformait une panne de gateway en arret du process.
  assert.doesNotThrow(() => {
    client.emit("error", Object.assign(new Error("getaddrinfo EAI_AGAIN discord.com"), { code: "EAI_AGAIN" }));
  });
});

test("reportError route une erreur applicative vers la supervision", async () => {
  _resetProcessGuards();
  const { client, sentLogs } = fakeClient();

  await reportError(client, "messageCreate", new TypeError("boum"));

  assert.equal(sentLogs.length, 1);
  assert.equal(sentLogs[0], "[fatal] messageCreate : boum");
});

test("reportError garde une coupure reseau hors du canal de supervision", async () => {
  _resetProcessGuards();
  const { client, sentLogs } = fakeClient();

  await reportError(
    client,
    "unhandledRejection",
    Object.assign(new Error("getaddrinfo EAI_AGAIN discord.com"), { code: "EAI_AGAIN" }),
  );

  assert.deepEqual(sentLogs, []);
});

test.after(() => {
  // Les garde-fous s'installent sur le process : les laisser en place masquerait
  // les rejets non captures des autres tests du meme fichier.
  for (const listener of process.listeners("unhandledRejection")) {
    if (!BEFORE.unhandledRejection.includes(listener)) process.off("unhandledRejection", listener);
  }
  for (const listener of process.listeners("uncaughtException")) {
    if (!BEFORE.uncaughtException.includes(listener)) process.off("uncaughtException", listener);
  }
  _resetProcessGuards();
});
