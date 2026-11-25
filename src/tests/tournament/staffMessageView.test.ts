import test from "node:test";
import assert from "node:assert/strict";
import { ButtonStyle, ComponentType } from "discord.js";
import { isTransientRefusal, langOf, previewPanel, refusalText, sentText } from "../../tournament/staffMessageView.js";
import type { StaffMessagePreview } from "../../tournament/siteStaffMessage.js";

// Panneau éphémère de /message-tournoi : comptes seuls, texte échappé, menu à choix multiples, FR et EN.

const preview = (overrides: Partial<StaffMessagePreview["recipients"]> = {}, name = "Coupe"): StaffMessagePreview => ({
  tournament: { id: 12, name },
  recipients: { total: 3, reachable: 2, withoutDiscord: 1, optedOut: 0, ...overrides },
});

type Panel = ReturnType<typeof previewPanel>;
const select = (panel: Panel) => panel.components[0].components[0] as unknown as {
  type: number; min_values: number; max_values: number; options: { value: string; label: string; default: boolean }[];
};
const sendButton = (panel: Panel) => panel.components[1].components[0] as unknown as { type: number; style: number; disabled: boolean; label: string };

function panel(overrides: Partial<Parameters<typeof previewPanel>[0]> = {}): Panel {
  return previewPanel({ preview: preview(), message: "Check-in à 20 h", categories: ["ALL"], expiresAt: 1764000000, lang: "fr", nonce: "n1", ...overrides });
}

test("langOf_englishLocale_returnsEn", () => {
  assert.equal(langOf("en-GB"), "en");
});

test("langOf_otherOrMissingLocale_returnsFr", () => {
  assert.deepEqual([langOf("fr"), langOf("de"), langOf(undefined)], ["fr", "fr", "fr"]);
});

test("previewPanel_menu_allowsOneToFiveWithAllPreselected", () => {
  const actual = select(panel());

  assert.equal(actual.type, ComponentType.StringSelect);
  assert.equal(actual.min_values, 1);
  assert.equal(actual.max_values, 5);
  assert.deepEqual(actual.options.map((o) => [o.value, o.label, o.default]), [
    ["PLAYERS", "Joueurs", false],
    ["MANAGERS", "Managers", false],
    ["CAPTAINS", "Capitaines", false],
    ["OWNERS", "Propriétaires", false],
    ["ALL", "Tous", true],
  ]);
});

test("previewPanel_selection_isReflectedAsDefaults", () => {
  const actual = select(panel({ categories: ["PLAYERS", "OWNERS"] }));

  assert.deepEqual(actual.options.filter((o) => o.default).map((o) => o.value), ["PLAYERS", "OWNERS"]);
});

test("previewPanel_english_labelsInEnglish", () => {
  const actual = panel({ lang: "en" });

  assert.equal(select(actual).options[4].label, "Everyone");
  assert.equal(sendButton(actual).label, "Send");
  assert.match(actual.content, /\*\*Recipients: 3\*\* — 2 by direct message, 1 without a linked Discord/);
});

test("previewPanel_counts_showNumbersAndExpiry", () => {
  const actual = panel();

  assert.match(actual.content, /\*\*Destinataires : 3\*\* — 2 en message privé, 1 sans Discord rattaché \(notification push seulement\), 0 ont coupé ces messages\./);
  assert.match(actual.content, /<t:1764000000:R>/);
});

test("previewPanel_withRecipients_sendEnabled", () => {
  const actual = sendButton(panel());

  assert.equal(actual.style, ButtonStyle.Success);
  assert.equal(actual.disabled, false);
});

test("previewPanel_everyoneOptedOut_sendDisabled", () => {
  const actual = panel({ preview: preview({ total: 2, reachable: 0, withoutDiscord: 0, optedOut: 2 }) });

  assert.equal(sendButton(actual).disabled, true);
  assert.match(actual.content, /Personne à prévenir/);
});

test("previewPanel_mentionsInNameAndText_areEscapedAndQuoted", () => {
  const actual = panel({ preview: preview({}, "@everyone **Cup**"), message: "<@&1> salut" });

  assert.match(actual.content, /\\@everyone \\\*\\\*Cup\\\*\\\*/);
  assert.match(actual.content, /\n> \\<\\@&1\\> salut\n/);
});

test("previewPanel_hugeEscapedText_staysUnderDiscordLimit", () => {
  const actual = panel({ message: "*".repeat(1200), preview: preview({}, "_".repeat(120)) });

  assert.ok(actual.content.length <= 2000);
});

test("refusalText_knownCode_explainsInFrench", () => {
  assert.equal(refusalText("FORBIDDEN", "fr"), "❌ Commande réservée au staff des tournois du site BlueGenji.");
});

test("refusalText_knownCode_explainsInEnglish", () => {
  assert.equal(refusalText("SITE_UNREACHABLE", "en"), "❌ BlueGenji site unreachable: try again later.");
});

test("refusalText_unknownCode_namesTheCode", () => {
  assert.equal(refusalText("SOMETHING_NEW", "fr"), "❌ Le site a refusé la demande (SOMETHING_NEW).");
});

test("refusalText_timeoutWhileSending_saysItMayStillBeSending", () => {
  assert.match(refusalText("SITE_TIMEOUT", "fr", true), /peut être encore en cours/);
});

test("sentText_delivery_reportsCountsOnly", () => {
  const actual = sentText({ ...preview(), delivery: { sent: 2, failed: 1, skipped: 1, pushed: 4, botUnreachable: false, pending: false, unconfirmed: 0 } }, "fr");

  assert.equal(actual, "✅ Message envoyé aux participants de Coupe : 2 messages privés remis, 1 non remis, 1 sans message privé (messages coupés ou sans Discord), 4 notifications push.");
});

test("sentText_botUnreachable_addsWarning", () => {
  const actual = sentText({ ...preview(), delivery: { sent: 0, failed: 2, skipped: 1, pushed: 3, botUnreachable: true, pending: false, unconfirmed: 0 } }, "en");

  assert.match(actual, /\n⚠️ The site could not confirm the direct messages/);
});

test("previewPanel_englishOwners_keepsOwners", () => {
  assert.equal(select(panel({ lang: "en" })).options[3].label, "Owners");
});

test("previewPanel_hugeEscapedText_keepsCountsAndExpiryAndSaysShortened", () => {
  const actual = panel({ message: "*".repeat(1200), preview: preview({}, "_".repeat(120)) });

  assert.ok(actual.content.length <= 2000);
  assert.match(actual.content, /\*\*Destinataires : 3\*\*/);
  assert.match(actual.content, /<t:1764000000:R>/);
  assert.match(actual.content, /aperçu raccourci : le message part en entier/);
});

test("previewPanel_manyShortLines_cutsAtALineEnd", () => {
  const actual = panel({ message: Array.from({ length: 600 }, () => "ab").join("\n") });

  assert.ok(actual.content.length <= 2000);
  assert.match(actual.content, /\n> ab\n> \*\(aperçu raccourci/);
});

test("refusalText_outcomeUnknownWhileSending_saysItMayHaveGoneOut", () => {
  assert.match(refusalText("SITE_OUTCOME_UNKNOWN", "fr", true), /peut-être parti/);
});

test("refusalText_internalErrorWhileSending_saysItMayHaveGoneOut", () => {
  assert.match(refusalText("INTERNAL_ERROR", "en", true), /may have gone out/);
});

test("refusalText_internalErrorOnPreview_saysTryAgain", () => {
  assert.equal(refusalText("INTERNAL_ERROR", "fr"), "❌ Le site BlueGenji a rencontré une erreur : réessaie dans un instant.");
});

test("refusalText_tokenRefused_saysMisconfigured", () => {
  assert.match(refusalText("UNAUTHORIZED", "fr"), /mal configurée/);
});

test("refusalText_quotaExceeded_saysPerStaffMember", () => {
  assert.match(refusalText("STAFF_MESSAGE_QUOTA_EXCEEDED", "fr"), /3 messages par heure et par membre du staff/);
});

test("isTransientRefusal_timeoutOrThrottle_returnsTrue", () => {
  assert.deepEqual([isTransientRefusal("SITE_TIMEOUT"), isTransientRefusal("TOO_MANY_REQUESTS")], [true, true]);
});

test("isTransientRefusal_forbidden_returnsFalse", () => {
  assert.equal(isTransientRefusal("FORBIDDEN"), false);
});

test("sentText_pendingWithoutCounts_saysSendingGoesOn", () => {
  const actual = sentText({ ...preview(), delivery: { sent: 0, failed: 0, skipped: 1, pushed: 0, botUnreachable: false, pending: true, unconfirmed: 0 } }, "fr");

  assert.match(actual, /^⏳ Le message part aux participants de Coupe : l'envoi continue sur le site\. Ne le relance pas/);
});

test("sentText_unconfirmed_addsMaybeDeliveredWarning", () => {
  const actual = sentText({ ...preview(), delivery: { sent: 1, failed: 1, skipped: 1, pushed: 0, botUnreachable: false, pending: false, unconfirmed: 25 } }, "en");

  assert.match(actual, /^✅ Message sent/);
  assert.match(actual, /\n⚠️ 25 direct messages without the bot's report: maybe delivered\. Do not run it again/);
});

test("sentText_unconfirmedFrench_addsMaybeDeliveredWarning", () => {
  const actual = sentText({ ...preview(), delivery: { sent: 0, failed: 0, skipped: 1, pushed: 2, botUnreachable: false, pending: false, unconfirmed: 3 } }, "fr");

  assert.match(actual, /\n⚠️ 3 messages privés sans bilan du bot : peut-être remis\. Ne le relance pas/);
});

test("sentText_noUnconfirmed_addsNoWarning", () => {
  const actual = sentText({ ...preview(), delivery: { sent: 2, failed: 0, skipped: 1, pushed: 0, botUnreachable: false, pending: false, unconfirmed: 0 } }, "fr");

  assert.doesNotMatch(actual, /sans bilan du bot/);
});

test("sentText_singleDelivery_usesSingularForms", () => {
  const fr = sentText({ ...preview(), delivery: { sent: 1, failed: 0, skipped: 0, pushed: 1, botUnreachable: false, pending: false, unconfirmed: 0 } }, "fr");
  const en = sentText({ ...preview(), delivery: { sent: 1, failed: 0, skipped: 0, pushed: 1, botUnreachable: false, pending: false, unconfirmed: 0 } }, "en");

  assert.match(fr, /1 message privé remis.*1 notification push./);
  assert.match(en, /1 direct message delivered.*1 push notification./);
});

test("sentText_nothingDeliveredBotUnreachable_isAWarningNotAGreenCheck", () => {
  const fr = sentText({ ...preview(), delivery: { sent: 0, failed: 2, skipped: 1, pushed: 0, botUnreachable: true, pending: false, unconfirmed: 0 } }, "fr");
  const en = sentText({ ...preview(), delivery: { sent: 0, failed: 2, skipped: 1, pushed: 0, botUnreachable: true, pending: false, unconfirmed: 0 } }, "en");

  assert.match(fr, /^⚠️ Aucun message n'a été remis.*ne compte pas dans ta limite : réessaie plus tard./);
  assert.match(en, /^⚠️ No message was delivered.*does not count towards your limit: try again later./);
});

test("sentText_nobodyReached_saysRerunningChangesNothing", () => {
  const fr = sentText({ ...preview(), delivery: { sent: 0, failed: 2, skipped: 1, pushed: 0, botUnreachable: false, pending: false, unconfirmed: 0 } }, "fr");
  const en = sentText({ ...preview(), delivery: { sent: 0, failed: 2, skipped: 1, pushed: 0, botUnreachable: false, pending: false, unconfirmed: 0 } }, "en");

  assert.match(fr, /^⚠️ Aucun participant n'a pu être joint.*n'y changerait rien./);
  assert.match(en, /^⚠️ No participant could be reached.*would not change anything./);
});

test("sentText_onlyPush_staysAGreenCheck", () => {
  const actual = sentText({ ...preview(), delivery: { sent: 0, failed: 0, skipped: 1, pushed: 2, botUnreachable: false, pending: false, unconfirmed: 0 } }, "fr");

  assert.match(actual, /^✅ Message envoyé/);
});

test("refusalText_invalidRequestCodes_areExplainedInBothLanguages", () => {
  for (const code of ["INVALID_STAFF_MESSAGE_REQUEST", "INVALID_RECIPIENT_CATEGORIES", "INVALID_TOURNAMENT_ID", "INVALID_DISCORD_ID"]) {
    assert.doesNotMatch(refusalText(code, "fr"), new RegExp(code));
    assert.doesNotMatch(refusalText(code, "en"), new RegExp(code));
  }
});

test("previewPanel_siteQuotedText_showsItVerbatim", () => {
  const quoted = "> @​everyone rendez\\-vous";

  const actual = panel({ preview: { ...preview(), quoted }, message: "@everyone rendez-vous" });

  assert.ok(actual.content.split("\n").includes(quoted));
});

test("previewPanel_noSiteQuotedText_quotesTheMessageItself", () => {
  const actual = panel({ message: "Salut" });

  assert.ok(actual.content.split("\n").includes("> Salut"));
});

