import test from "node:test";
import assert from "node:assert/strict";
import {
  BILINGUAL_SEPARATOR,
  bilingualText,
  localizedText,
  loginCodeMessage,
  parseDmLocale,
} from "../../notifications/dmLanguage.js";

const TEXT = { fr: "Bonjour", en: "Hello" };

test("parseDmLocale ne garde que fr et en", () => {
  assert.equal(parseDmLocale("fr"), "fr");
  assert.equal(parseDmLocale("en"), "en");
  for (const value of [undefined, null, "", "FR", "de", 1, {}]) {
    assert.equal(parseDmLocale(value), null, String(value));
  }
});

test("localizedText : la langue du compte seule, sinon un message bilingue (français d'abord)", () => {
  assert.equal(localizedText("fr", TEXT), "Bonjour");
  assert.equal(localizedText("en", TEXT), "Hello");
  assert.equal(localizedText(null, TEXT), `Bonjour${BILINGUAL_SEPARATOR}Hello`);
  assert.equal(bilingualText(TEXT), "Bonjour\n\n**— English —**\nHello");
});

test("loginCodeMessage : le français inchangé, l'anglais, le bilingue", () => {
  assert.equal(loginCodeMessage("042137", "fr"), "BlueGenji Arena - Code de connexion: **042137** (valide 10 minutes).");
  assert.equal(loginCodeMessage("042137", "en"), "BlueGenji Arena - Login code: **042137** (valid for 10 minutes).");
  const both = loginCodeMessage("042137", null);
  assert.ok(both.startsWith("BlueGenji Arena - Code de connexion"));
  assert.ok(both.endsWith("Login code: **042137** (valid for 10 minutes)."));
  assert.equal(both.split("042137").length - 1, 2, "un seul message, le code dans les deux langues");
});
