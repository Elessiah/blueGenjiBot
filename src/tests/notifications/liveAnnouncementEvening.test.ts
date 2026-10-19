import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits, type Client } from "discord.js";
import {
  announceLive,
  fillLinkTokens,
  formatLiveAnnouncement,
  isLiveIssueFinal,
  liveAllowedMentions,
  liveAnnouncementNonce,
  LiveChannelUnavailableError,
  liveFailureReport,
  loggedLiveText,
  MAX_LIVE_STREAM_URLS,
  MESSAGE_DELETED,
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

test("announceLive : message de la soirée supprimé → aucune suite, la soirée est close (suppression respectée)", async () => {
  const sent: Sent[] = [];
  const request = parseLiveAnnouncement({ ...EVENING, editMessageId: MESSAGE_ID });
  assert.ok(request);
  await assert.rejects(
    announceLive(fakeClient({ sent, editError: discordError("Unknown Message", 10008) }), request),
    (error: unknown) => error instanceof LiveChannelUnavailableError && error.key === MESSAGE_DELETED,
  );
  assert.equal(sent.length, 0);
  assert.equal(isLiveIssueFinal(MESSAGE_DELETED), true);
  // Signalement : ni le texte (il peut nommer un joueur) ni une consigne de le reposter.
  const report = liveFailureReport(request, MESSAGE_DELETED, "Unknown Message");
  assert.match(report, /supprimé de #live/);
  assert.match(report, /Le site n'y publie plus rien pour ce public jusqu'à la fin de la soirée\. Ne pas la reposter à la main\.$/);
  assert.doesNotMatch(report, /Annonce concernée|peut être postée/);
  // Site parti avant la réponse : il ne sait pas encore, il fermera au prochain direct.
  const gaveUp = liveFailureReport(request, MESSAGE_DELETED, "Unknown Message", { siteGaveUp: true });
  assert.match(gaveUp, /il fermera la soirée de ce public au prochain direct/);
  assert.doesNotMatch(gaveUp, /n'y publie plus rien/);
});

test("announceLive : message de la soirée plus modifiable → suite sans mention ni notification", async () => {
  for (const code of [50005, 30046]) {
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
  // Jeton d'unicité distinct de l'envoi qui a notifié : Discord ne rend pas ce message-là.
  assert.notEqual(liveAnnouncementNonce(request), liveAnnouncementNonce({ ...request, notify: undefined }));
});

const EVENING_REPORT = {
  message: "🔴 **Les lives de la soirée**\n\n**21:00** · En direct\nA contre B — Coupe\n{{lien:1}}",
  streamUrl: "https://www.twitch.tv/caster",
  streamUrls: ["https://www.twitch.tv/caster"],
  context: "live-announce soiree-3 tournoi-4 match-40",
};

test("liveFailureReport : soirée refusée, le site attendait encore → poster à la main sans aucune mention", () => {
  // Premier message bloqué par AutoMod : le site rend la marque, le direct suivant notifiera.
  for (const mention of ["everyone", "stream-viewer"] as const) {
    const first = liveFailureReport({ ...EVENING_REPORT, mention }, "automod", "x");
    assert.match(first, /sans aucune mention \(le prochain direct de la soirée notifiera son public\)/);
    assert.doesNotMatch(first, /avec la mention/);
  }
  // Modification, suite, envoi muet : un message de la soirée a pu notifier.
  for (const request of [
    { ...EVENING_REPORT, mention: "everyone" as const, editMessageId: "123456789012345678" },
    { ...EVENING_REPORT, mention: "stream-viewer" as const, notify: false as const },
  ]) {
    const report = liveFailureReport(request, "automod", "x");
    assert.match(report, /sans aucune mention \(un message de cette soirée a déjà pu notifier son public\)/);
    assert.doesNotMatch(report, /avec la mention/);
    // Le texte est toute la soirée : seuls les matchs absents de #live se postent.
    assert.match(report, /seuls les matchs de l'étiquette que #live ne montre pas encore peuvent être postés à la main/);
    assert.match(report, /pas le texte entier de la soirée/);
    assert.doesNotMatch(report, /sans doublon/);
  }
});

test("liveFailureReport : soirée refusée après l'abandon du site → il la croit partie", () => {
  // Premier message : poster à la main avec la mention de son public, le direct suivant ne notifiera pas.
  const everyone = liveFailureReport({ ...EVENING_REPORT, mention: "everyone" }, "send-rejected", "x", { siteGaveUp: true });
  assert.match(everyone, /postée à la main, avec la mention de tout le serveur en tête — le site la croit peut-être partie, le direct suivant de la soirée partira sans notification/);
  const viewers = liveFailureReport({ ...EVENING_REPORT, mention: "stream-viewer" }, "send-rejected", "x", { siteGaveUp: true });
  assert.match(viewers, /avec la mention du rôle StreamViewer en tête \(pas celle de tout le serveur\)/);
  // Modification ou envoi muet : ne pas la poster, le direct suivant la reprend.
  for (const request of [
    { ...EVENING_REPORT, mention: "everyone" as const, editMessageId: "123456789012345678" },
    { ...EVENING_REPORT, mention: "everyone" as const, notify: false as const },
  ]) {
    const report = liveFailureReport(request, "send-rejected", "x", { siteGaveUp: true });
    assert.match(report, /ne pas la poster à la main, le direct suivant de la soirée la reprendra dans son message/);
    assert.doesNotMatch(report, /peut être postée/);
  }
  // Panne pendant l'envoi : aucune consigne de la poster.
  assert.doesNotMatch(
    liveFailureReport({ ...EVENING_REPORT, mention: "everyone" }, "discord-down", "x", { siteGaveUp: true }),
    /à la main/,
  );
});

test("liveFailureReport : annonce simple → la mention de son public", () => {
  const single = { message: "Alpha contre Beta", streamUrl: "https://twitch.tv/bg", context: "live-announce match-1" };
  const viewers = liveFailureReport({ ...single, mention: "stream-viewer" as const }, "send-rejected", "x", { siteGaveUp: true });
  assert.match(viewers, /avec la mention du rôle StreamViewer en tête \(pas celle de tout le serveur\)/);
  assert.match(liveFailureReport(single, "send-rejected", "x", { siteGaveUp: true }), /avec la mention de tout le serveur en tête/);
});
