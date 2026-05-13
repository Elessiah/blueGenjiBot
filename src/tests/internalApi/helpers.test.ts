import test from "node:test";
import assert from "node:assert/strict";
import { pctDelta, absDelta, deterministicColor } from "../../internalApi/helpers.js";

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
