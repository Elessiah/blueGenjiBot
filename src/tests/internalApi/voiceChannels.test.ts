import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeChannelName, readVoiceKey, readChannelId } from "../../internalApi/voiceChannels.js";

test("sanitizeChannelName garde un nom d'equipe lisible", () => {
  assert.equal(sanitizeChannelName("Les Bleus"), "Les Bleus");
  assert.equal(sanitizeChannelName("  Team   Rocket  "), "Team Rocket");
});

test("sanitizeChannelName remplace les caracteres de controle", () => {
  assert.equal(sanitizeChannelName("Team\nRocket"), "Team Rocket");
  assert.equal(sanitizeChannelName("Team\u0000Rocket"), "Team Rocket");
});

test("sanitizeChannelName refuse un nom vide, trop long ou non textuel", () => {
  assert.equal(sanitizeChannelName(""), null);
  assert.equal(sanitizeChannelName("   "), null);
  assert.equal(sanitizeChannelName("\n\t"), null);
  assert.equal(sanitizeChannelName("a".repeat(101)), null);
  assert.equal(sanitizeChannelName(42), null);
  assert.equal(sanitizeChannelName(null), null);
  assert.equal(sanitizeChannelName(undefined), null);
});

test("sanitizeChannelName accepte exactement 100 caracteres", () => {
  assert.equal(sanitizeChannelName("a".repeat(100)), "a".repeat(100));
});

test("readVoiceKey accepte la cle du site et rien d'autre", () => {
  assert.equal(readVoiceKey("match:12:team:34"), "match:12:team:34");
  assert.equal(readVoiceKey("match:12:team:34 "), null);
  assert.equal(readVoiceKey("match/12"), null);
  assert.equal(readVoiceKey(""), null);
  assert.equal(readVoiceKey("a".repeat(121)), null);
  assert.equal(readVoiceKey(12), null);
});

test("readChannelId n'accepte qu'un identifiant Discord", () => {
  assert.equal(readChannelId("676735851119640577"), "676735851119640577");
  assert.equal(readChannelId("1234"), null);
  assert.equal(readChannelId("12345abc"), null);
  assert.equal(readChannelId("../../etc"), null);
  assert.equal(readChannelId(676735851119640577), null);
});
