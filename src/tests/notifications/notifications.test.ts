import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDirectMessageRequest,
  parseRefereeAlert,
  dedupeRecipients,
  truncateMessage,
  MAX_MESSAGE_LENGTH,
  MAX_RECIPIENTS,
  type DirectMessageRecipient,
} from "../../notifications/notifications.js";

const RECIPIENT = { discordId: "123456789", handle: "joueur", label: "Joueur" };

test("parseDirectMessageRequest accepte une demande complete", () => {
  const request = parseDirectMessageRequest({
    message: "Ton match commence dans 1 heure.",
    recipients: [RECIPIENT],
    context: "match-reminder",
  });
  assert.ok(request);
  assert.equal(request.message, "Ton match commence dans 1 heure.");
  assert.equal(request.context, "match-reminder");
  assert.deepEqual(request.recipients, [RECIPIENT]);
});

test("parseDirectMessageRequest garde un destinataire sans ID mais avec un tag", () => {
  const request = parseDirectMessageRequest({
    message: "Rappel",
    recipients: [{ handle: "sans_id", label: "Sans ID" }],
  });
  assert.ok(request);
  assert.deepEqual(request.recipients, [{ discordId: null, handle: "sans_id", label: "Sans ID" }]);
});

test("parseDirectMessageRequest ignore un ID non numerique et retombe sur le tag", () => {
  const request = parseDirectMessageRequest({
    message: "Rappel",
    recipients: [{ discordId: "pas-un-id", handle: "joueur", label: "Joueur" }],
  });
  assert.ok(request);
  assert.equal(request.recipients[0].discordId, null);
  assert.equal(request.recipients[0].handle, "joueur");
});

test("parseDirectMessageRequest ecarte un destinataire sans ID ni tag", () => {
  const request = parseDirectMessageRequest({
    message: "Rappel",
    recipients: [{ label: "Fantome" }, RECIPIENT],
  });
  assert.ok(request);
  assert.equal(request.recipients.length, 1);
});

test("parseDirectMessageRequest se replie sur le tag comme libelle", () => {
  const request = parseDirectMessageRequest({
    message: "Rappel",
    recipients: [{ handle: "joueur" }],
  });
  assert.ok(request);
  assert.equal(request.recipients[0].label, "joueur");
});

test("parseDirectMessageRequest refuse un message vide", () => {
  assert.equal(parseDirectMessageRequest({ message: "   ", recipients: [RECIPIENT] }), null);
});

test("parseDirectMessageRequest refuse une liste vide ou absente", () => {
  assert.equal(parseDirectMessageRequest({ message: "Rappel", recipients: [] }), null);
  assert.equal(parseDirectMessageRequest({ message: "Rappel" }), null);
});

test("parseDirectMessageRequest refuse un corps qui n'est pas un objet", () => {
  assert.equal(parseDirectMessageRequest(null), null);
  assert.equal(parseDirectMessageRequest("rappel"), null);
  assert.equal(parseDirectMessageRequest([RECIPIENT]), null);
});

test("parseDirectMessageRequest se replie sur un contexte par defaut", () => {
  const request = parseDirectMessageRequest({ message: "Rappel", recipients: [RECIPIENT] });
  assert.equal(request?.context, "site");
});

test("parseDirectMessageRequest borne le nombre de destinataires", () => {
  const many = Array.from({ length: MAX_RECIPIENTS + 20 }, (_, i) => ({
    discordId: String(100000 + i),
    label: `J${i}`,
  }));
  const request = parseDirectMessageRequest({ message: "Rappel", recipients: many });
  assert.equal(request?.recipients.length, MAX_RECIPIENTS);
});

test("parseDirectMessageRequest tronque un message trop long", () => {
  const request = parseDirectMessageRequest({
    message: "a".repeat(MAX_MESSAGE_LENGTH + 500),
    recipients: [RECIPIENT],
  });
  assert.equal(request?.message.length, MAX_MESSAGE_LENGTH);
  assert.ok(request?.message.endsWith("(message tronqué)"));
});

test("truncateMessage laisse un message court intact", () => {
  assert.equal(truncateMessage("court"), "court");
});

test("dedupeRecipients ecarte le meme ID et le meme tag", () => {
  const recipients: DirectMessageRecipient[] = [
    { discordId: "1", handle: null, label: "A" },
    { discordId: "1", handle: null, label: "A bis" },
    { discordId: null, handle: "Bob", label: "Bob" },
    { discordId: null, handle: "bob", label: "bob minuscule" },
    { discordId: null, handle: "carol", label: "Carol" },
  ];
  assert.deepEqual(dedupeRecipients(recipients).map((r) => r.label), ["A", "Bob", "Carol"]);
});

test("dedupeRecipients ne confond pas un ID et un tag identiques", () => {
  const recipients: DirectMessageRecipient[] = [
    { discordId: "42", handle: null, label: "par ID" },
    { discordId: null, handle: "42", label: "par tag" },
  ];
  assert.equal(dedupeRecipients(recipients).length, 2);
});

test("parseRefereeAlert accepte un signalement", () => {
  const alert = parseRefereeAlert({ message: "Probleme signale", context: "issue-report" });
  assert.deepEqual(alert, { message: "Probleme signale", context: "issue-report" });
});

test("parseRefereeAlert refuse un message vide ou un corps invalide", () => {
  assert.equal(parseRefereeAlert({ message: "" }), null);
  assert.equal(parseRefereeAlert(null), null);
  assert.equal(parseRefereeAlert([]), null);
});

test("parseRefereeAlert tronque un message trop long", () => {
  const alert = parseRefereeAlert({ message: "b".repeat(MAX_MESSAGE_LENGTH + 10) });
  assert.equal(alert?.message.length, MAX_MESSAGE_LENGTH);
});
