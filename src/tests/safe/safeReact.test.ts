import test from "node:test";
import assert from "node:assert/strict";
import type { Client, Message } from "discord.js";

import { safeReact } from "../../safe/safeReact.js";

process.env.OWNER_ID = "owner-test";
process.env.INFO_SERV = "info-test";

/**
 * Fabrique une erreur porteuse d'un code, à l'image de ce que lèvent Node et l'API Discord.
 * @param message Message de l'erreur.
 * @param code Code système ou code d'API Discord.
 * @returns L'erreur enrichie de son code.
 */
function withCode(message: string, code: string | number): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Construit un client Discord factice qui capture ce que `sendLog` publie.
 * @returns Le faux client et la liste des lignes parvenues au canal de supervision.
 */
function fakeClient(): { client: Client; sentLogs: string[] } {
  const sentLogs: string[] = [];
  const client = {
    users: {
      fetch: async () => ({
        send: async () => ({ id: "owner-msg" }),
      }),
    },
    channels: {
      fetch: async () => ({
        send: async (content: string) => {
          sentLogs.push(content);
          return { id: "admin-msg" };
        },
      }),
    },
  } as unknown as Client;
  return { client, sentLogs };
}

/**
 * Construit un message factice dont la réaction réussit ou échoue à la demande.
 * @param onReact Comportement de `react` : renvoie une valeur ou lève.
 * @returns Le faux message et la liste des émojis demandés.
 */
function fakeMessage(onReact: (emoji: string) => unknown): { message: Message; asked: string[] } {
  const asked: string[] = [];
  const message = {
    react: async (emoji: string) => {
      asked.push(emoji);
      return onReact(emoji);
    },
  } as unknown as Message;
  return { message, asked };
}

test("safeReact renvoie la reaction quand l'appel aboutit", async () => {
  const { client, sentLogs } = fakeClient();
  const { message, asked } = fakeMessage(() => ({ emoji: { name: "🛰️" } }));

  const reaction = await safeReact(client, message, "🛰️");

  assert.deepEqual(asked, ["🛰️"]);
  assert.ok(reaction);
  assert.deepEqual(sentLogs, []);
});

test("safeReact avale le 10008 d'un message supprime sans alerter la supervision", async () => {
  // Cas exact du log pm2 du 5 aout : reaction 🛰️ sur un message efface entre-temps.
  const { client, sentLogs } = fakeClient();
  const { message } = fakeMessage(() => { throw withCode("Unknown Message", 10008); });

  const reaction = await safeReact(client, message, "🛰️");

  assert.equal(reaction, null);
  assert.deepEqual(sentLogs, []);
});

test("safeReact avale une coupure reseau sans alerter la supervision", async () => {
  const { client, sentLogs } = fakeClient();
  const { message } = fakeMessage(() => { throw withCode("getaddrinfo EAI_AGAIN discord.com", "EAI_AGAIN"); });

  assert.equal(await safeReact(client, message, "📝"), null);
  assert.deepEqual(sentLogs, []);
});

test("safeReact alerte la supervision sur une erreur inattendue", async () => {
  const { client, sentLogs } = fakeClient();
  const { message } = fakeMessage(() => { throw new TypeError("emoji invalide"); });

  assert.equal(await safeReact(client, message, "🚫"), null);
  assert.equal(sentLogs.length, 1);
  assert.match(sentLogs[0], /safeReact \(🚫\) : emoji invalide/);
});

test("safeReact ne propage jamais, meme si la journalisation echoue", async () => {
  const brokenClient = {
    users: { fetch: async () => { throw new Error("API injoignable"); } },
    channels: { fetch: async () => { throw new Error("API injoignable"); } },
  } as unknown as Client;
  const { message } = fakeMessage(() => { throw new TypeError("boum"); });

  assert.equal(await safeReact(brokenClient, message, "🚫"), null);
});
