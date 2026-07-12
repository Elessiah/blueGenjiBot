import test from "node:test";
import assert from "node:assert/strict";

import { isDiscordInvite, normalizeInvite } from "../../utils/isDiscordInvite.js";

test("isDiscordInvite accepte les formats discord.gg valides", () => {
  assert.equal(isDiscordInvite("https://discord.gg/abc123"), true);
  assert.equal(isDiscordInvite("http://discord.gg/abc123"), true);
  assert.equal(isDiscordInvite("discord.gg/abc123"), true);
  assert.equal(isDiscordInvite("https://www.discord.gg/abc-123"), true);
});

test("isDiscordInvite accepte les formats discord.com/invite et discordapp.com/invite", () => {
  assert.equal(isDiscordInvite("https://discord.com/invite/abc123"), true);
  assert.equal(isDiscordInvite("https://discordapp.com/invite/abc123"), true);
  assert.equal(isDiscordInvite("discord.com/invite/abc123"), true);
});

test("isDiscordInvite tolere les espaces autour du lien", () => {
  assert.equal(isDiscordInvite("  https://discord.gg/abc123  "), true);
});

test("isDiscordInvite rejette les liens non-Discord ou malformes", () => {
  assert.equal(isDiscordInvite("https://example.com/invite/abc"), false);
  assert.equal(isDiscordInvite("https://discord.gg/"), false);
  assert.equal(isDiscordInvite("discord.gg"), false);
  assert.equal(isDiscordInvite("not a link"), false);
  assert.equal(isDiscordInvite(""), false);
  assert.equal(isDiscordInvite("https://evil.com/discord.gg/abc"), false);
});

test("normalizeInvite ajoute https:// quand le protocole manque", () => {
  assert.equal(normalizeInvite("discord.gg/abc123"), "https://discord.gg/abc123");
  assert.equal(normalizeInvite("  discord.gg/abc123 "), "https://discord.gg/abc123");
});

test("normalizeInvite preserve un protocole existant", () => {
  assert.equal(normalizeInvite("http://discord.gg/abc123"), "http://discord.gg/abc123");
  assert.equal(normalizeInvite("https://discord.com/invite/abc123"), "https://discord.com/invite/abc123");
});
