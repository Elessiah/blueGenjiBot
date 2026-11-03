import test from "node:test";
import assert from "node:assert/strict";
import {
  ADHESION_EXPIRED_DM,
  ADHESION_EXPIRED_REMINDER_DM,
  ADHESION_PAPERS_DM,
  ADHESION_VALID_DM,
  BILINGUAL_SEPARATOR,
  BRAND_NAME,
  banNoticeMessage,
  bilingualText,
  formatBanDate,
  localizedText,
  loginCodeMessage,
  parseCodePurpose,
  parseDmLocale,
  sliceWithoutSplittingPair,
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

test("banNoticeMessage : bilingue, le motif une seule fois à la fin, la date à l'heure de Paris", () => {
  const msg = banNoticeMessage("2026-10-26 13:03:00", "Spam");
  assert.equal(
    msg,
    "Vous êtes exclu du relais depuis le 26 octobre 2026 à 14:03 :" + BILINGUAL_SEPARATOR +
      "You have been banned from the relay since 26 October 2026 at 14:03: \nSpam",
  );
  assert.equal(msg.split("Spam").length, 2);
});

test("banNoticeMessage_dateObject_noRawDateString", () => {
  const msg = banNoticeMessage(new Date(0), "x");
  assert.doesNotMatch(msg, /GMT/);
  assert.match(msg, /depuis le 1 janvier 1970 à 01:00 :/);
  assert.match(msg, /since 1 January 1970 at 01:00:/);
});

test("formatBanDate_sqliteUtcString_parisTimeFr", () => {
  // `CURRENT_TIMESTAMP` est en UTC : 13 h 03 UTC = 14 h 03 à Paris (heure d'hiver).
  assert.equal(formatBanDate("2026-10-26 13:03:00", "fr"), "26 octobre 2026 à 14:03");
});

test("formatBanDate_sqliteUtcStringInSummer_parisTimeEn", () => {
  assert.equal(formatBanDate("2026-07-14 10:00:00", "en"), "14 July 2026 at 12:00");
});

test("formatBanDate_dateObject_formatted", () => {
  assert.equal(formatBanDate(new Date("2026-10-26T13:03:00Z"), "en"), "26 October 2026 at 14:03");
});

test("formatBanDate_unparseable_returnedAsIs", () => {
  assert.equal(formatBanDate("pas une date", "fr"), "pas une date");
});

test("sliceWithoutSplittingPair_cutInsideEmoji_dropsHighSurrogate", () => {
  assert.equal(sliceWithoutSplittingPair("ab😀c", 3), "ab");
});

test("sliceWithoutSplittingPair_cutAfterPair_keepsPair", () => {
  assert.equal(sliceWithoutSplittingPair("ab😀c", 4), "ab😀");
});

test("sliceWithoutSplittingPair_lengthBeyondText_returnsWhole", () => {
  assert.equal(sliceWithoutSplittingPair("ab😀", 10), "ab😀");
});

test("parseCodePurpose_handle_returnsHandle", () => {
  assert.equal(parseCodePurpose("handle"), "handle");
});

test("parseCodePurpose_unknownOrMissing_returnsLogin", () => {
  for (const value of [undefined, null, "", "login", "HANDLE", 1]) {
    assert.equal(parseCodePurpose(value), "login", String(value));
  }
});

test("loginCodeMessage_handlePurposeFr_saysNotLoginAndDoNotShare", () => {
  assert.equal(
    loginCodeMessage("123456", "fr", "handle"),
    "BlueGenji - Code de vérification de votre tag Discord : **123456** (valide 10 minutes). Il sert à rattacher ce tag à un compte BlueGenji, pas à vous connecter. Si vous n'en êtes pas à l'origine, ignorez ce message et ne transmettez ce code à personne.",
  );
});

test("loginCodeMessage_handlePurposeEn_saysNotLoginAndDoNotShare", () => {
  assert.equal(
    loginCodeMessage("123456", "en", "handle"),
    "BlueGenji - Verification code for your Discord tag: **123456** (valid for 10 minutes). It links this tag to a BlueGenji account; it does not sign you in. If you did not request it, ignore this message and never share this code.",
  );
});

test("loginCodeMessage_handlePurposeUnknownLocale_bilingual", () => {
  const [fr, en] = loginCodeMessage("123456", null, "handle").split(BILINGUAL_SEPARATOR);
  assert.match(fr, /^BlueGenji - Code de vérification/);
  assert.match(en, /^BlueGenji - Verification code/);
});

test("loginCodeMessage_defaultPurpose_unchangedLoginText", () => {
  assert.equal(loginCodeMessage("123456", "fr"), "BlueGenji - Code de connexion: **123456** (valide 10 minutes).");
  assert.equal(BRAND_NAME, "BlueGenji");
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
