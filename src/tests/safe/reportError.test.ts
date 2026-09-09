import test from "node:test";
import assert from "node:assert/strict";

import { createErrorReporter, MAX_TRACKED_KEYS } from "../../safe/reportError.js";

/**
 * Fabrique une erreur porteuse d'un code, à l'image de ce que lèvent Node et undici.
 * @param message Message de l'erreur.
 * @param code Code système ou code d'API Discord.
 * @returns L'erreur enrichie de son code.
 */
function withCode(message: string, code: string | number): Error {
  return Object.assign(new Error(message), { code });
}

/**
 * Monte un rapporteur avec des sorties enregistrées et une horloge pilotée.
 * @returns Le rapporteur, ses journaux et le curseur temporel modifiable.
 */
function setup(dedupeWindowMs = 60_000) {
  const consoleLines: string[] = [];
  const remoteLines: string[] = [];
  const clock = { value: 0 };
  const report = createErrorReporter({
    toConsole: (line) => consoleLines.push(line),
    toRemote: (line) => { remoteLines.push(line); },
    now: () => clock.value,
    dedupeWindowMs,
  });
  return { report, consoleLines, remoteLines, clock };
}

test("une erreur applicative part en console et vers la supervision", async () => {
  const { report, consoleLines, remoteLines } = setup();
  const severity = await report("commande /ping", new TypeError("boum"));
  assert.equal(severity, "fatal");
  assert.deepEqual(consoleLines, ["[fatal] commande /ping : boum"]);
  assert.deepEqual(remoteLines, ["[fatal] commande /ping : boum"]);
});

test("une coupure reseau reste en console : le canal de log passe par le reseau tombe", async () => {
  const { report, consoleLines, remoteLines } = setup();
  const severity = await report("unhandledRejection", withCode("getaddrinfo EAI_AGAIN discord.com", "EAI_AGAIN"));
  assert.equal(severity, "transient");
  assert.equal(consoleLines.length, 1);
  assert.deepEqual(remoteLines, []);
});

test("un message Discord disparu ne reveille pas la supervision", async () => {
  const { report, remoteLines, consoleLines } = setup();
  const severity = await report("safeReact", withCode("Unknown Message", 10008));
  assert.equal(severity, "ignorable");
  assert.equal(consoleLines.length, 1);
  assert.deepEqual(remoteLines, []);
});

test("les repetitions a l'identique sont etouffees dans la fenetre", async () => {
  const { report, consoleLines, clock } = setup(60_000);
  const error = withCode("getaddrinfo EAI_AGAIN discord.com", "EAI_AGAIN");
  for (let i = 0; i < 50; i++) {
    clock.value += 500;
    await report("unhandledRejection", error);
  }
  assert.equal(consoleLines.length, 1);
});

test("la premiere ligne apres la fenetre compte les occurrences etouffees", async () => {
  const { report, consoleLines, clock } = setup(60_000);
  const error = withCode("getaddrinfo EAI_AGAIN discord.com", "EAI_AGAIN");
  await report("unhandledRejection", error);
  clock.value += 1_000;
  await report("unhandledRejection", error);
  clock.value += 1_000;
  await report("unhandledRejection", error);
  clock.value += 60_000;
  await report("unhandledRejection", error);

  assert.equal(consoleLines.length, 2);
  assert.match(consoleLines[1], /\(\+2 occurrence\(s\) identique\(s\) étouffée\(s\)\)$/);
});

test("le compteur d'occurrences etouffees repart a zero apres emission", async () => {
  const { report, consoleLines, clock } = setup(60_000);
  const error = withCode("getaddrinfo EAI_AGAIN discord.com", "EAI_AGAIN");
  await report("unhandledRejection", error);
  clock.value += 1_000;
  await report("unhandledRejection", error);
  clock.value += 60_000;
  await report("unhandledRejection", error); // emet "+1"
  clock.value += 60_000;
  await report("unhandledRejection", error); // plus rien a signaler

  assert.equal(consoleLines.length, 3);
  assert.match(consoleLines[1], /\(\+1 occurrence/);
  assert.doesNotMatch(consoleLines[2], /occurrence/);
});

test("des contextes differents ne se dedoublonnent pas entre eux", async () => {
  const { report, consoleLines } = setup();
  const error = new TypeError("boum");
  await report("messageCreate", error);
  await report("messageUpdate", error);
  assert.equal(consoleLines.length, 2);
});

test("des erreurs differentes dans le meme contexte ne se dedoublonnent pas", async () => {
  const { report, consoleLines } = setup();
  await report("messageCreate", new TypeError("premier"));
  await report("messageCreate", new TypeError("second"));
  assert.equal(consoleLines.length, 2);
});

test("le rapporteur ne leve jamais, meme si ses sorties echouent", async () => {
  const report = createErrorReporter({
    toConsole: () => { throw new Error("console cassee"); },
    toRemote: () => Promise.reject(new Error("supervision injoignable")),
  });
  const severity = await report("clientReady", new TypeError("boum"));
  assert.equal(severity, "fatal");
});

test("la table de dedoublonnage reste bornee sous un flux d'erreurs toutes distinctes", async () => {
  // Un defaut dont le message porte un identifiant cree une cle neuve a chaque
  // occurrence : sans borne dure, la table grossirait sans fin sur un process
  // qui tourne des semaines.
  const { report, consoleLines, clock } = setup(60_000);
  for (let i = 0; i < MAX_TRACKED_KEYS * 3; i++) {
    clock.value += 10; // toutes les cles restent dans la fenetre
    await report("messageUpdate", new Error(`Unknown Message ${i}`));
  }
  assert.equal(consoleLines.length, MAX_TRACKED_KEYS * 3);

  // Les cles les plus anciennes ont ete evincees : la premiere erreur, reemise
  // a l'identique, est de nouveau journalisee au lieu d'etre etouffee.
  const before = consoleLines.length;
  clock.value += 10;
  await report("messageUpdate", new Error("Unknown Message 0"));
  assert.equal(consoleLines.length, before + 1);
});

test("une valeur non-Error rejetee est acceptee telle quelle", async () => {
  const { report, consoleLines } = setup();
  const severity = await report("unhandledRejection", "rejet sans Error");
  assert.equal(severity, "fatal");
  assert.equal(consoleLines[0], "[fatal] unhandledRejection : rejet sans Error");
});
