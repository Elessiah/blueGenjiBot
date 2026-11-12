import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyError,
  describeError,
  errorCode,
  isIgnorableDiscordError,
  isTransientNetworkError,
  MAX_CAUSE_DEPTH,
  safeErrorCode,
  safeErrorDetail,
  safeErrorKind,
  safeErrorStatus,
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
  assert.equal(describeError({ a: 1 }), "valeur levée non standard (object)");
});

test("describeError ne serialise jamais une valeur non-Error", () => {
  assert.equal(describeError({ content: "LFT pseudo#1234" }), "valeur levée non standard (object)");
  assert.equal(describeError(null), "valeur levée non standard (null)");
  assert.equal(describeError(42), "valeur levée non standard (42)");
  assert.equal(describeError(10n), "valeur levée non standard (10)");
  assert.equal(describeError({ code: 50013, content: "pseudo" }), "valeur levée non standard (object, code 50013)");
  assert.equal(describeError({ code: "LFT pseudo#1234" }), "valeur levée non standard (object)");
  const hostile = { get code(): string { throw new Error("boom"); } };
  assert.equal(describeError(hostile), "valeur levée non standard (object)");
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.equal(describeError(proxy), "valeur levée illisible");
  const odd = new Error("x");
  (odd as unknown as { message: unknown }).message = { content: "pseudo" };
  assert.equal(describeError(odd), "(message non textuel)");
  assert.equal(errorCode(proxy), null);
});

test("describeError ne leve pas sur une valeur non serialisable", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.equal(typeof describeError(circular), "string");
});

test("describeError rend le message d'une Error venue d'un autre contexte (vm)", async () => {
  const vm = await import("node:vm");
  const foreign: unknown = vm.runInNewContext("new Error('hors contexte')");
  assert.equal(foreign instanceof Error, false);
  const description = describeError(foreign);
  // `Error.isError` (Node 24) la reconnait ; sans lui, elle est decrite par son
  // seul type, jamais par un message lu sur un objet quelconque.
  if (typeof (Error as unknown as { isError?: unknown }).isError === "function") {
    assert.equal(description, "hors contexte");
  } else {
    assert.match(description, /^valeur levée non standard/);
  }
});

test("describeError ne prend pas un objet deguise en Error pour une Error", () => {
  const disguised = { [Symbol.toStringTag]: "Error", message: "pseudo de l'auteur" };
  const description = describeError(disguised);
  assert.doesNotMatch(description, /pseudo/);
  assert.match(description, /^valeur levée non standard/);
});

test("safeErrorCode_identifierCode_returnsIt", () => {
  assert.equal(safeErrorCode(Object.assign(new Error("x"), { code: "SQLITE_BUSY" })), "SQLITE_BUSY");
  assert.equal(safeErrorCode(Object.assign(new Error("x"), { code: 50035 })), 50035);
});

test("safeErrorCode_sentenceCode_returnsNull", () => {
  assert.equal(safeErrorCode(Object.assign(new Error("x"), { code: "Equipe Bleue introuvable" })), null);
});

test("safeErrorKind_freeTextName_returnsError", () => {
  assert.equal(safeErrorKind(Object.assign(new Error("x"), { name: "Equipe Bleue" })), "Error");
  assert.equal(safeErrorKind(new TypeError("x")), "TypeError");
});

test("safeErrorKind_discordApiErrorWithCodeSuffix_returnsBareName", () => {
  // discord.js nomme ses erreurs `DiscordAPIError[50035]` : le code se journalise à part.
  assert.equal(safeErrorKind(Object.assign(new Error("x"), { name: "DiscordAPIError[50035]" })), "DiscordAPIError");
});

test("safeErrorKind_throwingNameGetter_returnsError", () => {
  const error = new Error("x");
  Object.defineProperty(error, "name", { get(): string { throw new Error("revoked"); } });

  assert.equal(safeErrorKind(error), "Error");
});

test("safeErrorKind_nonError_returnsTypeof", () => {
  assert.equal(safeErrorKind("Equipe Bleue"), "string");
  assert.equal(safeErrorKind(null), "object");
});

test("safeErrorStatus_httpStatus_returnsIt", () => {
  assert.equal(safeErrorStatus(Object.assign(new Error("x"), { status: 429 })), 429);
});

test("safeErrorStatus_outOfRangeOrThrowing_returnsNull", () => {
  assert.equal(safeErrorStatus({ status: 99 }), null);
  assert.equal(safeErrorStatus({ status: "500" }), null);
  assert.equal(safeErrorStatus({ get status(): number { throw new Error("revoked"); } }), null);
});

test("safeErrorCode_knownFamilies_returnsCode", () => {
  for (const code of ["SQLITE_BUSY", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EPIPE", "EAI_AGAIN", "ERR_HTTP_HEADERS_SENT", "ERR_ASSERTION", "UND_ERR_SOCKET", "ABORT_ERR", "50035"]) {
    assert.equal(safeErrorCode(Object.assign(new Error("x"), { code })), code);
  }
});

test("safeErrorCode_singleWordFromInput_returnsNull", () => {
  // Un mot isolé a la forme d'un identifiant, sans en être un : il peut recopier une valeur reçue.
  for (const code of ["EquipeBleue", "auth/invalid-token", "CanalBleuNonCache", "pseudo.joueur", "EVIL", "ESPORTX", "EQUIPE_BLEUE", "ERR_"]) {
    assert.equal(safeErrorCode(Object.assign(new Error("x"), { code })), null);
  }
});

test("safeErrorCode_nonFiniteNumber_returnsNull", () => {
  assert.equal(safeErrorCode(Object.assign(new Error("x"), { code: Number.NaN })), null);
});

test("safeErrorKind_wordThatIsNotAnErrorClass_returnsError", () => {
  assert.equal(safeErrorKind(Object.assign(new Error("x"), { name: "EquipeBleue" })), "Error");
});

test("safeErrorKind_domException_keepsName", () => {
  assert.equal(safeErrorKind(Object.assign(new Error("x"), { name: "DOMException" })), "DOMException");
});

test("safeErrorDetail_errorWithCodeAndStatus_returnsKindCodeStatusWithoutMessage", () => {
  const error = Object.assign(new Error("Missing Permissions pour Equipe Bleue"), {
    name: "DiscordAPIError[50013]", code: 50013, status: 403,
  });

  assert.equal(safeErrorDetail(error), "DiscordAPIError, code 50013, statut 403");
});

test("safeErrorDetail_nullRejection_returnsTypeWithUnknownCode", () => {
  assert.equal(safeErrorDetail(null), "object, code inconnu");
  assert.equal(safeErrorDetail(undefined), "undefined, code inconnu");
});

test("safeErrorCode_discordjsEnumCode_returnsIt", () => {
  const error = Object.assign(new Error("x"), { code: "GuildMembersTimeout" });

  assert.equal(safeErrorCode(error), "GuildMembersTimeout");
});

test("safeErrorCode_wordOutsideDiscordjsEnum_returnsNull", () => {
  const error = Object.assign(new Error("x"), { code: "GuildMembersTimeoutX" });

  assert.equal(safeErrorCode(error), null);
});
