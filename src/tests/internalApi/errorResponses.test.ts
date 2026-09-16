import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Garde de source plutot que d'integration.
 *
 * Les routes vivent dans `startInternalApi(client)`, qui ouvre un port et un
 * client Discord : les exercer demanderait de monter le serveur entier pour
 * observer une chaine de caractere. Or ce qu'on veut tenir n'est pas le
 * comportement d'un handler mais une **forme** — celle du prochain handler
 * qu'on ecrira. Un test de source la tient sur les vingt-quatre existants comme
 * sur le suivant, ce qu'aucune requete ne ferait.
 */
const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "internalApi.ts"),
  "utf8",
);

test("le fichier source est bien lu", () => {
  // Un chemin casse rendrait les assertions suivantes vertes pour rien.
  assert.ok(SOURCE.includes("startInternalApi"), "internalApi.ts introuvable");
});

test("aucune reponse d'erreur ne renvoie le message de l'exception", () => {
  // `res.status(500).json({ error: (error as Error).message || "CODE" })` :
  // le code stable etait le *repli*, et la pile d'appel, le chemin du fichier
  // ou le fragment de SQL que porte le message partaient a l'appelant.
  const leaking = SOURCE.split("\n")
    .map((line, index) => ({ line: line.trim(), number: index + 1 }))
    .filter(({ line }) => /res\.status\(\d{3}\)\.json\(/.test(line) && /as Error\)\.message/.test(line));
  assert.deepEqual(leaking, [], "reponse HTTP portant un message d'exception");
});

test("chaque reponse 500 porte un code stable en majuscules", () => {
  const codes = [...SOURCE.matchAll(/res\.status\(500\)\.json\(\{ error: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 8, `trop peu de reponses 500 trouvees (${codes.length})`);
  for (const code of codes) {
    assert.match(code, /^[A-Z][A-Z0-9_]*$/, `code non stable : ${code}`);
  }
});

test("le detail de l'erreur part au journal Discord", () => {
  // Le message n'est pas perdu, il change de destinataire : l'exploitant le
  // lit dans le salon de logs, l'appelant recoit un code.
  const logged = [...SOURCE.matchAll(/sendLog\(client, `\/internal\/[^`]*error: \$\{\(error as Error\)\.message\}`\)/g)];
  assert.ok(logged.length >= 8, `trop peu de journalisations (${logged.length})`);
});

test("le flux SSE ne repond plus une fois les en-tetes envoyes", () => {
  // `flushHeaders()` a deja repondu : un `res.status().json()` dans le `catch`
  // leve ERR_HTTP_HEADERS_SENT, donc un rejet non gere qu'Express 4 ne
  // rattrape pas.
  //
  // On verifie l'invariant — la garde precede la reponse — et non son
  // orthographe : la premiere redaction epinglait `res.end();` a la ligne
  // suivante, si bien qu'entourer cet appel d'un `try/catch` (contre une
  // socket deja detruite) faisait echouer un code devenu meilleur.
  const garde = SOURCE.indexOf("if (res.headersSent)");
  assert.ok(garde !== -1, "aucune garde sur `res.headersSent`");
  const finDeGarde = SOURCE.indexOf("}", SOURCE.indexOf("return;", garde));
  assert.match(SOURCE.slice(garde, finDeGarde), /res\.end\(\)/);
  // ...et la reponse d'erreur vient bien apres, donc hors du chemin garde.
  assert.ok(SOURCE.indexOf('"INTERNAL_FEED_ERROR"', garde) > finDeGarde);
});
