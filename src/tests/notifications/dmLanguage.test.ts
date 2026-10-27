import test from "node:test";
import assert from "node:assert/strict";
import {
  ADHESION_EXPIRED_DM,
  ADHESION_EXPIRED_REMINDER_DM,
  ADHESION_PAPERS_DM,
  ADHESION_VALID_DM,
  BILINGUAL_SEPARATOR,
  banNoticeMessage,
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
  assert.equal(loginCodeMessage("042137", "fr"), "BlueGenji - Code de connexion: **042137** (valide 10 minutes).");
  assert.equal(loginCodeMessage("042137", "en"), "BlueGenji - Login code: **042137** (valid for 10 minutes).");
  const both = loginCodeMessage("042137", null);
  assert.ok(both.startsWith("BlueGenji - Code de connexion"));
  assert.ok(both.endsWith("Login code: **042137** (valid for 10 minutes)."));
  assert.equal(both.split("042137").length - 1, 2, "un seul message, le code dans les deux langues");
});

test("textes par défaut des messages privés du bot : le français inchangé d'abord, puis l'anglais", () => {
  const cases: Array<[string, string, string]> = [
    [ADHESION_PAPERS_DM, "Voici les papiers pour l'adhésion à l'association BlueGenji :", "Here are the membership papers"],
    [ADHESION_VALID_DM, "Votre adhésion BlueGenji a été validée. Merci d'avoir rejoint l'association !", "has been confirmed"],
    [ADHESION_EXPIRED_REMINDER_DM, "Votre adhésion BlueGenji est périmée.", "has expired"],
    [ADHESION_EXPIRED_DM, "Votre adhésion à l'association est à présent périmée.", "has now expired"],
  ];
  for (const [text, french, english] of cases) {
    const [fr, en] = text.split(BILINGUAL_SEPARATOR);
    assert.ok(fr.startsWith(french), fr);
    assert.ok(en.includes(english), en);
  }
});

test("banNoticeMessage : bilingue, le motif une seule fois à la fin, une Date acceptée comme avant", () => {
  const msg = banNoticeMessage("2026-10-26", "Spam");
  assert.equal(
    msg,
    "Vous êtes exclu du relais depuis le 2026-10-26 :" + BILINGUAL_SEPARATOR + "You have been banned from the relay since 2026-10-26: \nSpam",
  );
  assert.equal(msg.split("Spam").length, 2);
  const date = new Date(0);
  assert.ok(banNoticeMessage(date, "x").includes("since " + String(date) + ":"));
});

test("banNoticeMessage : un motif long est coupé, l'avis tient sous les 2000 caractères de Discord", () => {
  const exact = "a".repeat(2000 - banNoticeMessage("2026-10-26", "").length);
  assert.equal(banNoticeMessage("2026-10-26", exact).length, 2000);
  assert.ok(banNoticeMessage("2026-10-26", exact).endsWith("a"));
  const long = banNoticeMessage(new Date(0), "b".repeat(1990));
  assert.equal(long.length, 2000);
  assert.ok(long.endsWith("b…"));
  assert.ok(long.startsWith("Vous êtes exclu du relais depuis le "));
});

test("banNoticeMessage : la coupe ne sépare jamais un émoji en deux", () => {
  const room = 2000 - banNoticeMessage("2026-10-26", "").length;
  // L'émoji (deux unités UTF-16) chevauche le point de coupe (room - 1).
  const msg = banNoticeMessage("2026-10-26", "c".repeat(room - 2) + "😀" + "d".repeat(50));
  assert.ok(msg.length <= 2000);
  assert.ok(msg.endsWith("c…"));
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(msg), false);
});
