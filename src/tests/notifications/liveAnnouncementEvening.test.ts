import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits, type Client } from "discord.js";
import {
  announceLive,
  fillLinkTokens,
  formatLiveAnnouncement,
  liveAllowedMentions,
  liveAnnouncementNonce,
  liveFailureReport,
  loggedLiveText,
  MAX_LIVE_STREAM_URLS,
  parseLiveAnnouncement,
  STREAM_VIEWER_ROLE_ID,
} from "../../notifications/liveAnnouncement.js";

/**
 * Annonces de soirée : public notifié (`@everyone` pour la chaîne officielle,
 * rôle StreamViewer sinon), liens placés dans le texte, modification du
 * message de la soirée sans nouvelle notification, suite muette si le message
 * a disparu. Discord est simulé : rien ne part.
 */

type Sent = { content: string; allowedMentions: unknown; nonce?: string };
type Edited = { id: string; content: string; allowedMentions: unknown };

function discordError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

function fakeClient(options: { sent: Sent[]; edited?: Edited[]; editError?: Error; denied?: bigint[] }): Client {
  return {
    user: { id: "bot" },
    channels: {
      fetch: async () => ({
        permissionsFor: () => ({ has: (flag: bigint) => !(options.denied ?? []).includes(flag) }),
        send: async (payload: Sent) => {
          options.sent.push(payload);
          return { id: "222222222222222222" };
        },
        messages: {
          edit: async (id: string, payload: Omit<Edited, "id">) => {
            if (options.editError) { throw options.editError; }
            options.edited?.push({ id, ...payload });
            return { id };
          },
        },
      }),
    },
  } as unknown as Client;
}

const OFFICIAL = "https://www.twitch.tv/bluegenjiesport";
const OTHER = "https://www.twitch.tv/uncaster";
const MESSAGE_ID = "111111111111111111";

const EVENING = {
  message: "🔴 Les lives de la soirée\n\n**21:00** · En direct\nAlpha contre Beta — Coupe\n{{lien:1}}\n\n**22:00**\nGamma contre Delta — Coupe\n{{lien:2}}",
  streamUrl: OTHER,
  streamUrls: [OTHER, "https://kick.com/autre"],
  context: "live-announce soiree-3",
  mention: "stream-viewer",
};

test("parseLiveAnnouncement : public, liens de soirée et message à modifier validés", () => {
  const request = parseLiveAnnouncement({ ...EVENING, editMessageId: MESSAGE_ID });
  assert.equal(request?.mention, "stream-viewer");
  assert.deepEqual(request?.streamUrls, EVENING.streamUrls);
  assert.equal(request?.editMessageId, MESSAGE_ID);
  // Champs absents : l'ancien corps du site reste valide, @everyone par défaut.
  const legacy = parseLiveAnnouncement({ message: "x", streamUrl: OFFICIAL });
  assert.equal(legacy?.mention, undefined);
  assert.equal(legacy?.streamUrls, undefined);
});

test("parseLiveAnnouncement : public, liens ou identifiant invalides → refus", () => {
  for (const patch of [
    { mention: "here" },
    { mention: 1 },
    { streamUrls: [] },
    { streamUrls: "https://kick.com/x" },
    { streamUrls: [OTHER, "https://piege.example/x"] },
    { streamUrls: ["https://kick.com/autre", OTHER] },
    { streamUrls: Array.from({ length: MAX_LIVE_STREAM_URLS + 1 }, () => OTHER) },
    { editMessageId: "abc" },
    { editMessageId: 123 },
    { notify: true },
    { notify: "false" },
  ]) {
    assert.equal(parseLiveAnnouncement({ ...EVENING, ...patch }), null, JSON.stringify(patch));
  }
});

test("liveAllowedMentions : @everyone pour la chaîne officielle, le rôle StreamViewer sinon, rien pour une modification", () => {
  assert.equal(STREAM_VIEWER_ROLE_ID, "1210173681771479060");
  assert.deepEqual(liveAllowedMentions("everyone", true), { parse: ["everyone"], roles: [] });
  assert.deepEqual(liveAllowedMentions(undefined, true), { parse: ["everyone"], roles: [] });
  assert.deepEqual(liveAllowedMentions("stream-viewer", true), { parse: [], roles: [STREAM_VIEWER_ROLE_ID] });
  assert.deepEqual(liveAllowedMentions("stream-viewer", false), { parse: [], roles: [] });
});

test("formatLiveAnnouncement : liens placés aux jetons, aucun lien ajouté en fin, mention du rôle en tête", () => {
  const request = parseLiveAnnouncement(EVENING);
  assert.ok(request);
  const content = formatLiveAnnouncement(request);
  assert.ok(content.startsWith(`<@&${STREAM_VIEWER_ROLE_ID}> 🔴`));
  assert.ok(content.includes(`\n${OTHER}\n`));
  assert.ok(content.endsWith("\nhttps://kick.com/autre"));
  assert.equal(content.split(OTHER).length, 2, "le premier lien n'est pas répété en fin");
  assert.ok(!formatLiveAnnouncement(request, false).includes("<@&"));
});

test("fillLinkTokens : jeton sans lien retiré, liens habillés au canal de logs", () => {
  assert.equal(fillLinkTokens("a {{lien:3}} b", [OTHER]), "a  b");
  assert.equal(fillLinkTokens("{{lien:1}}", undefined), "{{lien:1}}");
  const request = parseLiveAnnouncement({ ...EVENING, logMessage: "un joueur\n{{lien:1}}" });
  assert.ok(request);
  assert.equal(loggedLiveText(request), `un joueur\n<${OTHER}>`);
});

test("parseLiveAnnouncement : une mention de rôle glissée dans le texte reste neutralisée", () => {
  const request = parseLiveAnnouncement({ ...EVENING, message: `<@&${STREAM_VIEWER_ROLE_ID}> @everyone {{lien:1}}` });
  assert.ok(request);
  const content = formatLiveAnnouncement(request);
  assert.equal(content.split(`<@&${STREAM_VIEWER_ROLE_ID}>`).length, 2, "seule la mention de tête est active");
  assert.ok(!content.slice(1).includes("@everyone"));
});

test("announceLive : nouvelle soirée hors chaîne officielle → rôle StreamViewer seul, identifiant rendu", async () => {
  const sent: Sent[] = [];
  const request = parseLiveAnnouncement(EVENING);
  assert.ok(request);
  const report = await announceLive(fakeClient({ sent }), request);
  assert.deepEqual(report, { posted: true, mentionEveryone: true, embedLinks: true, messageId: "222222222222222222", edited: false });
  assert.deepEqual(sent[0].allowedMentions, { parse: [], roles: [STREAM_VIEWER_ROLE_ID] });
});

test("announceLive : chaîne officielle → @everyone seul", async () => {
  const sent: Sent[] = [];
  const request = parseLiveAnnouncement({ ...EVENING, streamUrl: OFFICIAL, streamUrls: [OFFICIAL], mention: "everyone" });
  assert.ok(request);
  await announceLive(fakeClient({ sent }), request);
  assert.deepEqual(sent[0].allowedMentions, { parse: ["everyone"], roles: [] });
  assert.ok(sent[0].content.startsWith("@everyone "));
});

test("announceLive : soirée déjà annoncée → message modifié, sa mention gardée, rien de nouveau", async () => {
  const sent: Sent[] = [];
  const edited: Edited[] = [];
  const request = parseLiveAnnouncement({ ...EVENING, editMessageId: MESSAGE_ID });
  assert.ok(request);
  const report = await announceLive(fakeClient({ sent, edited }), request);
  assert.equal(report.edited, true);
  assert.equal(report.messageId, MESSAGE_ID);
  assert.equal(sent.length, 0);
  assert.equal(edited.length, 1);
  // Mention de tête toujours autorisée : Discord ne la recalcule pas en
  // « personne » (surlignage gardé) ; une modification ne notifie jamais.
  assert.ok(edited[0].content.startsWith(`<@&${STREAM_VIEWER_ROLE_ID}> `));
  assert.deepEqual(edited[0].allowedMentions, { parse: [], roles: [STREAM_VIEWER_ROLE_ID] });
  const official = parseLiveAnnouncement({ ...EVENING, mention: "everyone", editMessageId: MESSAGE_ID });
  assert.ok(official);
  await announceLive(fakeClient({ sent, edited }), official);
  assert.deepEqual(edited[1].allowedMentions, { parse: ["everyone"], roles: [] });
});

test("announceLive : message de la soirée disparu ou plus modifiable → suite sans mention ni notification", async () => {
  for (const code of [10008, 50005, 30046]) {
    const sent: Sent[] = [];
    const request = parseLiveAnnouncement({ ...EVENING, editMessageId: MESSAGE_ID });
    assert.ok(request);
    const report = await announceLive(fakeClient({ sent, editError: discordError("Unknown Message", code) }), request);
    assert.equal(report.edited, false);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { parse: [], roles: [] });
    assert.ok(!sent[0].content.includes("<@&"));
    // Jeton d'unicité distinct du premier envoi : Discord ne l'avale pas.
    assert.notEqual(sent[0].nonce, liveAnnouncementNonce({ ...request, editMessageId: undefined }));
  }
});

test("announceLive : la modification d'un message parti sans mention (`notify: false`) n'en écrit pas", async () => {
  const sent: Sent[] = [];
  const edited: Edited[] = [];
  const request = parseLiveAnnouncement({ ...EVENING, editMessageId: MESSAGE_ID, notify: false });
  assert.ok(request);
  const report = await announceLive(fakeClient({ sent, edited }), request);
  assert.equal(report.edited, true);
  assert.equal(edited.length, 1);
  assert.ok(edited[0].content.startsWith("🔴"), edited[0].content);
  assert.deepEqual(edited[0].allowedMentions, { parse: [], roles: [] });
  // Sans `notify` : la mention de tête du message d'origine reste écrite.
  const plain = parseLiveAnnouncement({ ...EVENING, editMessageId: MESSAGE_ID });
  assert.ok(plain);
  await announceLive(fakeClient({ sent, edited }), plain);
  assert.ok(edited[1].content.startsWith(`<@&${STREAM_VIEWER_ROLE_ID}> `));
  assert.equal(sent.length, 0);
});

test("announceLive : une modification refusée pour une autre raison est une erreur, pas une suite", async () => {
  const sent: Sent[] = [];
  const request = parseLiveAnnouncement({ ...EVENING, editMessageId: MESSAGE_ID });
  assert.ok(request);
  await assert.rejects(announceLive(fakeClient({ sent, editError: discordError("Missing Access", 50001) }), request));
  assert.equal(sent.length, 0);
});

test("announceLive : sans permission de mentionner, la soirée part sans mention écrite", async () => {
  const sent: Sent[] = [];
  const request = parseLiveAnnouncement(EVENING);
  assert.ok(request);
  const report = await announceLive(fakeClient({ sent, denied: [PermissionFlagsBits.MentionEveryone] }), request);
  assert.equal(report.mentionEveryone, false);
  assert.deepEqual(sent[0].allowedMentions, { parse: [], roles: [] });
  assert.ok(sent[0].content.startsWith("🔴"));
});

test("announceLive : `notify: false` → nouveau message sans mention écrite ni notification", async () => {
  const request = parseLiveAnnouncement({ ...EVENING, notify: false });
  assert.equal(request?.notify, false);
  assert.ok(request);
  for (const mention of ["stream-viewer", "everyone"] as const) {
    const sent: Sent[] = [];
    const report = await announceLive(fakeClient({ sent }), { ...request, mention });
    assert.equal(report.edited, false);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].allowedMentions, { parse: [], roles: [] });
    assert.ok(sent[0].content.startsWith("🔴"), mention);
  }
});

test("liveFailureReport : poster à la main — mention du public, aucune pour une soirée déjà annoncée", () => {
  const base = {
    message: "🔴 **Les lives de la soirée**\n\n**21:00** · En direct\nA contre B — Coupe\n{{lien:1}}",
    streamUrl: "https://www.twitch.tv/caster",
    streamUrls: ["https://www.twitch.tv/caster"],
    context: "live-announce soiree-3 tournoi-4 match-40",
  };
  const everyone = liveFailureReport({ ...base, mention: "everyone" as const }, "send-rejected", "x", { siteGaveUp: true });
  assert.match(everyone, /avec la mention de tout le serveur en tête/);
  const viewers = liveFailureReport({ ...base, mention: "stream-viewer" as const }, "send-rejected", "x", { siteGaveUp: true });
  assert.match(viewers, /avec la mention du rôle StreamViewer en tête \(pas celle de tout le serveur\)/);
  assert.doesNotMatch(viewers, /avec la mention de tout le serveur/);
  // Modification de la soirée, suite, envoi muet : une mention notifierait deux fois.
  for (const request of [
    { ...base, mention: "everyone" as const, editMessageId: "123456789012345678" },
    { ...base, mention: "stream-viewer" as const, notify: false as const },
  ]) {
    for (const report of [
      liveFailureReport(request, "send-rejected", "x", { siteGaveUp: true }),
      liveFailureReport(request, "automod", "x"),
    ]) {
      assert.match(report, /sans aucune mention \(un message de cette soirée a déjà pu notifier son public\)/);
      assert.doesNotMatch(report, /avec la mention/);
    }
  }
});
