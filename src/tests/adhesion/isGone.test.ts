import test from "node:test";
import assert from "node:assert/strict";
import { DiscordAPIError } from "discord.js";

import { isGone } from "../../adhesion/isGone.js";

/** Fabrique une erreur discord.js portant le code donne. */
function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: "test" },
    code,
    404,
    "GET",
    "https://discord.test",
    {},
  );
}

test("reconnait les objets que Discord declare inconnus", () => {
  // Les seuls cas ou une suppression definitive en base est justifiee.
  for (const code of [10013, 10004, 10007, 10003, 10011]) {
    assert.equal(isGone(apiError(code)), true, `code ${code}`);
  }
});

test("ne prend pas une limite de debit pour une disparition", () => {
  // 429 : Discord dit « pas maintenant », pas « jamais ». Le `catch` d'origine
  // ne regardait pas la cause et supprimait la programmation.
  assert.equal(isGone(apiError(20028)), false);
});

test("ne prend pas une panne reseau pour une disparition", () => {
  // Le cas le plus courant, et le plus destructeur : une coupure pendant le
  // balayage effacait des rappels que personne ne pouvait plus retrouver.
  assert.equal(isGone(new Error("ECONNRESET")), false);
  assert.equal(isGone(new TypeError("fetch failed")), false);
});

test("repond non sur tout ce qui n'est pas une erreur", () => {
  // Dans le doute on garde la ligne : un rappel qui survit a tort se supprime
  // d'une commande, un rappel efface a tort ne se retrouve pas.
  assert.equal(isGone(undefined), false);
  assert.equal(isGone(null), false);
  assert.equal(isGone("10013"), false);
  assert.equal(isGone({ code: 10013 }), false);
});
