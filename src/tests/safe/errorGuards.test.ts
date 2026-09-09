import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyError,
  describeError,
  errorCode,
  isIgnorableDiscordError,
  isTransientNetworkError,
  MAX_CAUSE_DEPTH,
} from "../../safe/errorGuards.js";

/**
 * Fabrique une erreur porteuse d'un code, à l'image de ce que lèvent Node et undici.
 * @param message Message de l'erreur.
 * @param code Code système ou code d'API Discord.
 * @returns L'erreur enrichie de son code.
 */
function withCode(message: string, code: string | number): Error {
  return Object.assign(new Error(message), { code });
}

test("isTransientNetworkError reconnait la coupure DNS du crash du 8 septembre", () => {
  const dnsFailure = withCode("getaddrinfo EAI_AGAIN discord.com", "EAI_AGAIN");
  assert.equal(isTransientNetworkError(dnsFailure), true);
});

test("isTransientNetworkError reconnait le timeout de connexion undici", () => {
  const timeout = withCode(
    "Connect Timeout Error (attempted address: discord.com:443, timeout: 10000ms)",
    "UND_ERR_CONNECT_TIMEOUT",
  );
  assert.equal(isTransientNetworkError(timeout), true);
});

test("isTransientNetworkError suit la chaine de causes des erreurs enveloppees", () => {
  const wrapped = new Error("fetch failed", { cause: withCode("socket hang up", "ECONNRESET") });
  assert.equal(isTransientNetworkError(wrapped), true);
});

test("isTransientNetworkError ne boucle pas sur une cause auto-referente", () => {
  const looping: Error & { cause?: unknown } = new Error("boucle");
  looping.cause = looping;
  assert.equal(isTransientNetworkError(looping), false);
});

test("isTransientNetworkError ne deborde pas sur deux causes mutuelles", () => {
  // Certaines couches de retry rattachent l'erreur precedente en cause :
  // sans borne, la recursion exploserait dans le gestionnaire d'unhandledRejection.
  const first: Error & { cause?: unknown } = new Error("premier");
  const second: Error & { cause?: unknown } = new Error("second");
  first.cause = second;
  second.cause = first;
  assert.equal(isTransientNetworkError(first), false);
});

test("isTransientNetworkError abandonne au-dela de la profondeur maximale", () => {
  // La coupure reseau est enfouie plus profond que la borne : on prefere un
  // faux 'fatal' (bruyant) a un debordement de pile.
  let deepest: Error = withCode("socket hang up", "ECONNRESET");
  for (let i = 0; i <= MAX_CAUSE_DEPTH; i++) {
    deepest = new Error(`couche ${i}`, { cause: deepest });
  }
  assert.equal(isTransientNetworkError(deepest), false);
});

test("isTransientNetworkError trouve la cause dans la profondeur autorisee", () => {
  let nested: Error = withCode("socket hang up", "ECONNRESET");
  for (let i = 0; i < MAX_CAUSE_DEPTH - 1; i++) {
    nested = new Error(`couche ${i}`, { cause: nested });
  }
  assert.equal(isTransientNetworkError(nested), true);
});

test("un statut HTTP non-2xx d'undici n'est pas une panne reseau", () => {
  // UND_ERR_RESPONSE_STATUS_CODE signale une reponse 4xx/5xx : un 500
  // permanent doit remonter a la supervision, pas etre pris pour une coupure.
  const httpError = withCode("Response status code 500", "UND_ERR_RESPONSE_STATUS_CODE");
  assert.equal(isTransientNetworkError(httpError), false);
  assert.equal(classifyError(httpError), "fatal");
});

test("isTransientNetworkError rejette une erreur applicative", () => {
  assert.equal(isTransientNetworkError(new TypeError("Cannot read properties of null")), false);
  assert.equal(isTransientNetworkError(withCode("Unknown Message", 10008)), false);
});

test("isIgnorableDiscordError reconnait le 10008 leve par une reaction sur message supprime", () => {
  assert.equal(isIgnorableDiscordError(withCode("Unknown Message", 10008)), true);
});

test("isIgnorableDiscordError couvre interaction expiree, acces et permissions manquants", () => {
  assert.equal(isIgnorableDiscordError(withCode("Unknown interaction", 10062)), true);
  assert.equal(isIgnorableDiscordError(withCode("Missing Access", 50001)), true);
  assert.equal(isIgnorableDiscordError(withCode("Missing Permissions", 50013)), true);
});

test("isIgnorableDiscordError rejette un code Discord inconnu et les codes chaine", () => {
  assert.equal(isIgnorableDiscordError(withCode("Server Error", 50035)), false);
  assert.equal(isIgnorableDiscordError(withCode("Unknown Message", "10008")), false);
});

test("errorCode extrait un code chaine ou numerique et ignore le reste", () => {
  assert.equal(errorCode(withCode("x", "EAI_AGAIN")), "EAI_AGAIN");
  assert.equal(errorCode(withCode("x", 10008)), 10008);
  assert.equal(errorCode(new Error("sans code")), null);
  assert.equal(errorCode(Object.assign(new Error("x"), { code: { nested: true } })), null);
  assert.equal(errorCode(null), null);
  assert.equal(errorCode("chaine"), null);
});

test("classifyError trie les trois familles", () => {
  assert.equal(classifyError(withCode("getaddrinfo EAI_AGAIN", "EAI_AGAIN")), "transient");
  assert.equal(classifyError(withCode("Unknown Message", 10008)), "ignorable");
  assert.equal(classifyError(new TypeError("boum")), "fatal");
});

test("classifyError donne la priorite au reseau sur le code Discord", () => {
  // Une erreur reseau ne doit pas basculer en 'fatal' meme si elle porte
  // aussi un code numerique inconnu du bot.
  const both = Object.assign(new Error("fetch failed"), {
    cause: withCode("timeout", "UND_ERR_CONNECT_TIMEOUT"),
  });
  assert.equal(classifyError(both), "transient");
});

test("describeError suffixe le code et supporte les valeurs non-Error", () => {
  assert.equal(describeError(withCode("Unknown Message", 10008)), "Unknown Message [10008]");
  assert.equal(describeError(new Error("nu")), "nu");
  assert.equal(describeError("chaine brute"), "chaine brute");
  assert.equal(describeError({ a: 1 }), '{"a":1}');
});

test("describeError ne leve pas sur une valeur non serialisable", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(typeof describeError(circular), "string");
});
