import test from "node:test";
import assert from "node:assert/strict";
import { pctDelta, absDelta, deterministicColor, isLoopbackHost, matchesToken } from "../../internalApi/helpers.js";

test("pctDelta calcule un pourcentage et formate le signe", () => {
  assert.equal(pctDelta(120, 100), "+20 %");
  assert.equal(pctDelta(80, 100), "-20 %");
  assert.equal(pctDelta(100, 100), "+0 %");
});

test("pctDelta gere prev=0 (croissance infinie -> +100 %, ou 0 si nul)", () => {
  assert.equal(pctDelta(5, 0), "+100 %");
  assert.equal(pctDelta(0, 0), "+0 %");
});

test("absDelta formate le signe correctement", () => {
  assert.equal(absDelta(15, 12), "+3");
  assert.equal(absDelta(10, 15), "-5");
  assert.equal(absDelta(7, 7), "+0");
});

test("deterministicColor renvoie une couleur HSL valide et stable pour le meme id", () => {
  const c1 = deterministicColor("123456789012345678");
  const c2 = deterministicColor("123456789012345678");
  assert.equal(c1, c2);
  assert.match(c1, /^hsl\(\d+, 65%, 50%\)$/);
});

test("deterministicColor donne des couleurs differentes pour des ids differents (probabilite)", () => {
  const c1 = deterministicColor("aaaaaaaaaaaaaaaaaa");
  const c2 = deterministicColor("zzzzzzzzzzzzzzzzzz");
  assert.notEqual(c1, c2);
});

test("deterministicColor accepte une string vide sans crash", () => {
  const c = deterministicColor("");
  assert.match(c, /^hsl\(\d+, 65%, 50%\)$/);
});

test("isLoopbackHost reconnait les adresses confinees a la machine", () => {
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("::ffff:127.0.0.1"), true);
});

test("isLoopbackHost retient la valeur par defaut de startInternalApi", () => {
  // `INTERNAL_API_HOST` absente vaut 127.0.0.1 des deux cotes : si les deux
  // divergeaient, la garde raisonnerait sur une interface non ecoutee.
  assert.equal(isLoopbackHost(undefined), true);
  assert.equal(isLoopbackHost(""), false);
});

test("isLoopbackHost refuse une ecoute ouverte sur le reseau", () => {
  assert.equal(isLoopbackHost("0.0.0.0"), false);
  assert.equal(isLoopbackHost("::"), false);
  assert.equal(isLoopbackHost("192.168.1.22"), false);
});

test("matchesToken accepte le jeton exact et rien d'autre", () => {
  assert.equal(matchesToken("s3cret", "s3cret"), true);
  assert.equal(matchesToken("s3creT", "s3cret"), false);
  assert.equal(matchesToken("", "s3cret"), false);
});

test("matchesToken refuse un header absent", () => {
  assert.equal(matchesToken(undefined, "s3cret"), false);
});

test("matchesToken supporte des longueurs differentes sans lever", () => {
  // Les deux valeurs sont hachees avant comparaison : `timingSafeEqual` leve
  // sur deux tampons de tailles differentes, et cette levee serait un canal.
  assert.equal(matchesToken("court", "un jeton nettement plus long"), false);
  assert.equal(matchesToken("un jeton nettement plus long", "court"), false);
});
