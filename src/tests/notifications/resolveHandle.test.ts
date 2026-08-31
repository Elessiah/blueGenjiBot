import test from "node:test";
import assert from "node:assert/strict";
import { parseDiscordHandle } from "../../notifications/resolveHandle.js";

test("parseDiscordHandle reconnait un snowflake", () => {
  assert.deepEqual(parseDiscordHandle("123456789012345"), {
    kind: "id",
    discordId: "123456789012345",
  });
});

test("parseDiscordHandle reconnait un tag simple", () => {
  assert.deepEqual(parseDiscordHandle("joueur"), {
    kind: "tag",
    username: "joueur",
    discriminator: null,
  });
});

test("parseDiscordHandle tolere le prefixe arobase", () => {
  assert.deepEqual(parseDiscordHandle("  @joueur "), {
    kind: "tag",
    username: "joueur",
    discriminator: null,
  });
});

test("parseDiscordHandle lit le legacy pseudo#1234", () => {
  assert.deepEqual(parseDiscordHandle("joueur#0420"), {
    kind: "tag",
    username: "joueur",
    discriminator: "0420",
  });
});

test("parseDiscordHandle garde un diese qui n'est pas un discriminant", () => {
  assert.deepEqual(parseDiscordHandle("jou#eur"), {
    kind: "tag",
    username: "jou#eur",
    discriminator: null,
  });
});

test("parseDiscordHandle refuse une chaine vide ou reduite a un arobase", () => {
  assert.equal(parseDiscordHandle(""), null);
  assert.equal(parseDiscordHandle("   "), null);
  assert.equal(parseDiscordHandle("@"), null);
});

test("parseDiscordHandle ne prend pas un nombre trop court pour un ID", () => {
  assert.deepEqual(parseDiscordHandle("1234"), {
    kind: "tag",
    username: "1234",
    discriminator: null,
  });
});
