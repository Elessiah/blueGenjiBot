import test from "node:test";
import assert from "node:assert/strict";
import { ButtonStyle, ComponentType } from "discord.js";
import { langOf, previewPanel, refusalText, sentText } from "../../tournament/staffMessageView.js";
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
    ["OWNERS", "Owners", false],
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
  const actual = sentText({ ...preview(), delivery: { sent: 2, failed: 1, skipped: 1, pushed: 4, botUnreachable: false } }, "fr");

  assert.equal(actual, "✅ Message envoyé aux participants de Coupe : 2 message(s) privé(s) remis, 1 non remis, 1 sans message privé (messages coupés ou sans Discord), 4 notification(s) push.");
});

test("sentText_botUnreachable_addsWarning", () => {
  const actual = sentText({ ...preview(), delivery: { sent: 0, failed: 2, skipped: 1, pushed: 0, botUnreachable: true } }, "en");

  assert.match(actual, /\n⚠️ The site could not confirm the direct messages/);
});
