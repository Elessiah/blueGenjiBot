import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits, type Client } from "discord.js";
import {
  announceLive,
  formatLiveAnnouncement,
  isAllowedStreamUrl,
  LIVE_ANNOUNCE_CHANNEL_ID,
  LIVE_LOG_COOLDOWN_MS,
  LiveChannelUnavailableError,
  MAX_LIVE_MESSAGE_LENGTH,
  isLiveIssueFinal,
  liveFailureReport,
  liveFailureVerdict,
  liveAnnouncementNonce,
  describeLiveIssue,
  forgetLiveIssue,
  parseLiveAnnouncement,
  resetLiveLogThrottle,
  shouldLogLiveIssue,
} from "../../notifications/liveAnnouncement.js";
import { MAX_MESSAGE_LENGTH } from "../../notifications/notifications.js";

/**
 * Annonce de live (`POST /internal/announce/live`) : validation du corps, texte
 * publié, mention `@everyone` autorisée pour ce seul envoi, et refus quand le
 * salon est fermé au bot. Discord est simulé : rien ne part.
 */

type Sent = { channelId: string; content: string; allowedMentions: unknown; nonce?: string; enforceNonce?: boolean };

/** Erreur façon `DiscordAPIError` : un message et un code numérique. */
function discordError(message: string, code: number): Error {
  return Object.assign(new Error(message), { code });
}

function fakeClient(options: {
  sent: Sent[];
  channel?: "missing" | "throw" | "send-fails";
  denied?: bigint[];
  fetchError?: Error;
  sendError?: Error;
}): Client {
  return {
    user: { id: "bot" },
    channels: {
      fetch: async (id: string) => {
        if (options.fetchError) { throw options.fetchError; }
        if (options.channel === "throw") { throw new Error("Missing Access"); }
        if (options.channel === "missing") { return null; }
        return {
          permissionsFor: () => ({ has: (flag: bigint) => !(options.denied ?? []).includes(flag) }),
          send: async (payload: Omit<Sent, "channelId">) => {
            if (options.sendError) { throw options.sendError; }
            if (options.channel === "send-fails") { throw new Error("Missing Permissions"); }
            options.sent.push({ channelId: id, ...payload });
            return { id: "m1" };
          },
        };
      },
    },
  } as unknown as Client;
}

const REQUEST = { message: "Alpha contre Beta — Coupe d'hiver", streamUrl: "https://www.twitch.tv/bluegenji", context: "live-announce match-4" };

test("isAllowedStreamUrl : https et liste blanche seulement", () => {
  assert.equal(isAllowedStreamUrl("https://twitch.tv/bluegenji"), true);
  assert.equal(isAllowedStreamUrl("https://youtu.be/abc"), true);
  assert.equal(isAllowedStreamUrl("https://kick.com/x"), true);
  assert.equal(isAllowedStreamUrl("http://twitch.tv/bluegenji"), false);
  assert.equal(isAllowedStreamUrl("https://twitch.tv.exemple.com/x"), false);
  assert.equal(isAllowedStreamUrl("https://user:pass@twitch.tv/x"), false);
  assert.equal(isAllowedStreamUrl("https://twitch.tv:8443/x"), false);
  assert.equal(isAllowedStreamUrl("javascript:alert(1)"), false);
  assert.equal(isAllowedStreamUrl("https://twitch.tv/" + "a".repeat(260)), false);
});

test("parseLiveAnnouncement : corps valide normalisé, sinon null", () => {
  assert.deepEqual(parseLiveAnnouncement(REQUEST), REQUEST);
  assert.equal(parseLiveAnnouncement(null), null);
  assert.equal(parseLiveAnnouncement([]), null);
  assert.equal(parseLiveAnnouncement({ ...REQUEST, message: "  " }), null);
  assert.equal(parseLiveAnnouncement({ ...REQUEST, streamUrl: "https://evil.example/x" }), null);
  assert.equal(parseLiveAnnouncement({ message: "x", streamUrl: "https://kick.com/x" })?.context, "live-announce");
  const long = parseLiveAnnouncement({ ...REQUEST, message: "x".repeat(5000) });
  assert.ok(long && long.message.length <= MAX_MESSAGE_LENGTH);
});

test("formatLiveAnnouncement : mention en tête, lien seul sur sa ligne", () => {
  assert.equal(
    formatLiveAnnouncement(REQUEST),
    "@everyone Alpha contre Beta — Coupe d'hiver\nhttps://www.twitch.tv/bluegenji",
  );
});

test("formatLiveAnnouncement : sans permission de mentionner, pas de « @everyone » gris", () => {
  assert.equal(
    formatLiveAnnouncement(REQUEST, false),
    "Alpha contre Beta — Coupe d'hiver\nhttps://www.twitch.tv/bluegenji",
  );
});

test("formatLiveAnnouncement : message le plus long + lien le plus long tiennent dans 2 000 caractères", () => {
  const streamUrl = "https://www.twitch.tv/" + "a".repeat(255 - "https://www.twitch.tv/".length);
  const request = parseLiveAnnouncement({ message: "x".repeat(5000), streamUrl });
  assert.ok(request);
  const content = formatLiveAnnouncement(request);
  assert.equal(content.length, 2000);
  assert.ok(content.startsWith("@everyone x"));
  assert.ok(content.endsWith(`…\n${streamUrl}`), "le lien reste entier, seul sur sa ligne");
});

test("announceLive : publie dans #live, @everyone autorisé pour ce seul message", async () => {
  const sent: Sent[] = [];
  const report = await announceLive(fakeClient({ sent }), REQUEST);
  assert.deepEqual(report, { posted: true, mentionEveryone: true, embedLinks: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, LIVE_ANNOUNCE_CHANNEL_ID);
  assert.equal(LIVE_ANNOUNCE_CHANNEL_ID, "678961388030394401");
  assert.deepEqual(sent[0].allowedMentions, { parse: ["everyone"] });
  assert.ok(sent[0].content.startsWith("@everyone "));
});

test("announceLive : sans la permission de mentionner, publie et le dit", async () => {
  const sent: Sent[] = [];
  const report = await announceLive(fakeClient({ sent, denied: [PermissionFlagsBits.MentionEveryone] }), REQUEST);
  assert.deepEqual(report, { posted: true, mentionEveryone: false, embedLinks: true });
  assert.equal(sent.length, 1);
  // Ni mention écrite (elle s'afficherait en gris sans notifier), ni mention autorisée.
  assert.ok(!sent[0].content.includes("@everyone"));
  assert.deepEqual(sent[0].allowedMentions, { parse: [] });
});

test("announceLive : sans « Intégrer des liens », publie et le dit", async () => {
  const sent: Sent[] = [];
  const report = await announceLive(fakeClient({ sent, denied: [PermissionFlagsBits.EmbedLinks] }), REQUEST);
  assert.deepEqual(report, { posted: true, mentionEveryone: true, embedLinks: false });
  assert.equal(sent.length, 1);
});

test("LiveChannelUnavailableError : clé stable, indépendante du texte d'erreur de Discord", async () => {
  const error = await announceLive(fakeClient({ sent: [], channel: "send-fails" }), REQUEST).catch((e: unknown) => e);
  assert.ok(error instanceof LiveChannelUnavailableError);
  // Sans code Discord, rien ne dit qu'une permission manque : panne passagère.
  assert.equal(error.key, "discord-down");
  assert.match(error.message, /Missing Permissions/);
});

test("announceLive : salon absent, illisible, fermé ou envoi refusé → LiveChannelUnavailableError", async () => {
  const cases: Parameters<typeof fakeClient>[0][] = [
    { sent: [], channel: "missing" },
    { sent: [], channel: "throw" },
    { sent: [], channel: "send-fails" },
    { sent: [], denied: [PermissionFlagsBits.SendMessages] },
    { sent: [], denied: [PermissionFlagsBits.ViewChannel] },
  ];
  for (const options of cases) {
    await assert.rejects(announceLive(fakeClient(options), REQUEST), LiveChannelUnavailableError);
    assert.equal(options.sent.length, 0);
  }
});

test("shouldLogLiveIssue : un même incident signalé une fois par heure, chaque incident pour lui-même", () => {
  resetLiveLogThrottle();
  const now = 1_000_000;
  assert.equal(shouldLogLiveIssue("LIVE_CHANNEL_UNAVAILABLE: permission d'écrire absente", now), true);
  // Le site réessaie toutes les dix secondes : pas de deuxième signalement.
  assert.equal(shouldLogLiveIssue("LIVE_CHANNEL_UNAVAILABLE: permission d'écrire absente", now + 10_000), false);
  assert.equal(shouldLogLiveIssue("mention-everyone", now + 10_000), true);
  assert.equal(shouldLogLiveIssue("LIVE_CHANNEL_UNAVAILABLE: permission d'écrire absente", now + LIVE_LOG_COOLDOWN_MS - 1), false);
  assert.equal(shouldLogLiveIssue("LIVE_CHANNEL_UNAVAILABLE: permission d'écrire absente", now + LIVE_LOG_COOLDOWN_MS), true);
  resetLiveLogThrottle();
});

test("parseLiveAnnouncement : un texte trop long est coupé d'un « … », sans la mention des messages privés", () => {
  const request = parseLiveAnnouncement({ ...REQUEST, message: "x".repeat(5000) });
  assert.ok(request);
  assert.equal(request.message.length, MAX_LIVE_MESSAGE_LENGTH);
  assert.ok(request.message.endsWith("…"));
  assert.ok(!request.message.includes("message tronqué"));
});

test("parseLiveAnnouncement : un texte de plusieurs lignes (annonce groupée) est gardé tel quel", () => {
  const message = "🔴 En direct — Coupe :\n• Alpha contre Beta\n• Gamma contre Delta";
  assert.equal(parseLiveAnnouncement({ ...REQUEST, message })?.message, message);
});

test("describeLiveIssue : le staff lit l'action à mener, en français", () => {
  assert.match(describeLiveIssue("no-send", "x"), /« Envoyer des messages »/);
  assert.doesNotMatch(describeLiveIssue("no-send", "x"), /Voir le salon/);
  assert.match(describeLiveIssue("no-view", "x"), /« Voir le salon »/);
  assert.match(describeLiveIssue("missing", "x"), /introuvable ou invisible/);
  assert.equal(
    describeLiveIssue("send-denied", "Missing Access"),
    "Discord a refusé l'envoi faute de permission (Missing Access) — vérifier les permissions du bot dans #live",
  );
  assert.match(describeLiveIssue("discord-down", "503 Service Unavailable"), /l'annonce a pu partir malgré tout \(vérifier #live\)$/);
  assert.match(describeLiveIssue("discord-unreachable", "ECONNRESET"), /rien n'est parti/);
  assert.match(describeLiveIssue("automod", "x"), /Paramètres du serveur → AutoMod/);
  assert.doesNotMatch(describeLiveIssue("send-rejected", "x"), /AutoMod/);
  assert.match(describeLiveIssue("missing", "x"), /LIVE_ANNOUNCE_CHANNEL_ID/);
  // La route ajoute déjà que le site réessaie : la cause ne le répète pas.
  for (const key of ["missing", "no-view", "no-send", "send-denied", "automod", "send-rejected", "discord-unreachable", "discord-down", "failed"]) {
    assert.ok(!describeLiveIssue(key, "x").includes("réessaie"), key);
  }
  assert.ok(describeLiveIssue("failed", "y".repeat(5000)).length < 400, "texte brut borné");
  assert.equal(describeLiveIssue("failed", "boom"), "erreur inattendue (boom)");
});

test("forgetLiveIssue : un signalement qui n'est pas parti ne fait pas taire l'heure suivante", () => {
  resetLiveLogThrottle();
  assert.equal(shouldLogLiveIssue("no-send", 1000), true);
  assert.equal(shouldLogLiveIssue("no-send", 2000), false);
  forgetLiveIssue("no-send");
  assert.equal(shouldLogLiveIssue("no-send", 3000), true);
  resetLiveLogThrottle();
});

test("LiveChannelUnavailableError : le détail brut de Discord est gardé à part", async () => {
  const error = await announceLive(fakeClient({ sent: [], channel: "send-fails" }), REQUEST).catch((e: unknown) => e);
  assert.ok(error instanceof LiveChannelUnavailableError);
  assert.equal(error.detail, "Missing Permissions");
});

test("announceLive : une permission manquante se distingue d'une panne passagère de Discord", async () => {
  const cases: [Parameters<typeof fakeClient>[0], string][] = [
    [{ sent: [], fetchError: discordError("Unknown Channel", 10003) }, "missing"],
    [{ sent: [], fetchError: discordError("Missing Access", 50001) }, "missing"],
    // Panne en lisant le salon : rien n'est parti.
    [{ sent: [], fetchError: new Error("ECONNRESET") }, "discord-unreachable"],
    [{ sent: [], denied: [PermissionFlagsBits.ViewChannel] }, "no-view"],
    [{ sent: [], denied: [PermissionFlagsBits.SendMessages] }, "no-send"],
    [{ sent: [], sendError: discordError("Missing Permissions", 50013) }, "send-denied"],
    [{ sent: [], sendError: discordError("Service Unavailable", 0) }, "discord-down"],
    [{ sent: [], sendError: new Error("socket hang up") }, "discord-down"],
    // Délai dépassé (undici : `AbortError`, code numérique 20) : le message a pu partir.
    [{ sent: [], sendError: Object.assign(new Error("This operation was aborted"), { name: "AbortError", code: 20 }) }, "discord-down"],
    // Refus explicite (AutoMod, mode lent…) : rien n'est parti, ce n'est pas une panne.
    [{ sent: [], sendError: discordError("Message blocked by AutoMod", 200000) }, "automod"],
    [{ sent: [], sendError: discordError("Message blocked by AutoMod", 200001) }, "automod"],
    [{ sent: [], sendError: discordError("Cannot send messages in a non-text channel", 50008) }, "send-rejected"],
    // Salon supprimé alors que le cache le gardait : introuvable, pas un réglage.
    [{ sent: [], sendError: discordError("Unknown Channel", 10003) }, "missing"],
  ];
  for (const [options, key] of cases) {
    const error = await announceLive(fakeClient(options), REQUEST).catch((e: unknown) => e);
    assert.ok(error instanceof LiveChannelUnavailableError);
    assert.equal(error.key, key);
  }
});

test("announceLive : jeton d'unicité stable, Discord ne crée pas deux fois la même annonce", async () => {
  const sent: Sent[] = [];
  await announceLive(fakeClient({ sent }), REQUEST);
  await announceLive(fakeClient({ sent }), REQUEST);
  assert.equal(sent[0].enforceNonce, true);
  assert.equal(sent[0].nonce, sent[1].nonce);
  assert.ok(sent[0].nonce && sent[0].nonce.length <= 25);
  assert.notEqual(liveAnnouncementNonce({ ...REQUEST, context: "live-announce match-5" }), sent[0].nonce);
});

test("parseLiveAnnouncement : une mention de masse glissée dans le texte ne notifie pas", () => {
  const request = parseLiveAnnouncement({ ...REQUEST, message: "Alpha @here contre @everyone" });
  assert.ok(request);
  assert.ok(!/@(here|everyone)/.test(request.message));
  assert.ok(formatLiveAnnouncement(request).startsWith("@everyone "), "la mention de tête reste");
});

test("formatLiveAnnouncement : jamais un émoji coupé en deux", () => {
  const streamUrl = "https://twitch.tv/bg";
  const budget = 2000 - "@everyone ".length - 1 - streamUrl.length;
  // L'émoji (deux unités) chevauche la coupe.
  const message = "x".repeat(budget - 2) + "🔴" + "y".repeat(50);
  const content = formatLiveAnnouncement({ message, streamUrl, context: "c" });
  assert.ok(content.length <= 2000);
  assert.ok(!content.includes("\ud83d…"));
  assert.ok(/x…\n/.test(content), "l'émoji entier est retiré, pas sa moitié");
});

test("parseLiveAnnouncement : une étiquette trop longue est coupée d'un « … » visible", () => {
  const context = "live-announce match-" + Array.from({ length: 40 }, (_, i) => 10_000 + i).join(",");
  const request = parseLiveAnnouncement({ ...REQUEST, context });
  assert.ok(request);
  assert.equal(request.context.length, 200);
  assert.ok(request.context.endsWith("…"));
});

test("liveFailureVerdict : seule une panne pendant l'envoi est « non confirmée »", () => {
  assert.equal(liveFailureVerdict("discord-down"), "non confirmée");
  for (const key of ["discord-unreachable", "missing", "no-view", "no-send", "send-denied", "automod", "send-rejected", "failed"]) {
    assert.equal(liveFailureVerdict(key), "non publiée", key);
  }
});

test("announceLive : la raison d'une panne pendant l'envoi ne dit pas « refusé »", async () => {
  const error = await announceLive(fakeClient({ sent: [], sendError: new Error("socket hang up") }), REQUEST).catch((e: unknown) => e);
  assert.ok(error instanceof LiveChannelUnavailableError);
  assert.ok(!/refusé/.test(error.message), error.message);
  assert.match(error.message, /sans réponse claire/);
});

test("liveFailureReport : ne promet un nouvel essai que si le site en fera un", () => {
  const request = { message: "Alpha contre Beta", streamUrl: "https://twitch.tv/bg", context: "live-announce match-1" };
  assert.match(liveFailureReport(request, "no-send", "x"), /Le site la réessaie seul/);
  assert.match(liveFailureReport(request, "automod", "x"), /Le site ne la réessaie pas : AutoMod bloquerait/);
  // Un refus lié à l'état du salon se règle : le site réessaie.
  assert.match(liveFailureReport(request, "send-rejected", "x"), /Le site la réessaie seul/);
  assert.match(liveFailureReport(request, "discord-down", "x"), /pour ne pas notifier deux fois/);
  // Le site a coupé la requête avant la réponse : aucune cause n'est réessayée.
  const late = liveFailureReport(request, "no-send", "x", { siteGaveUp: true });
  assert.match(late, /avait déjà cessé d'attendre/);
  assert.doesNotMatch(late, /réessaie seul/);
  assert.equal(isLiveIssueFinal("automod"), true);
  assert.equal(isLiveIssueFinal("send-rejected"), false);
});


test("liveFailureReport : dit quand une annonce abandonnée peut être postée à la main", () => {
  const request = { message: "Alpha contre Beta", streamUrl: "https://twitch.tv/bg", context: "live-announce match-1" };
  // Site parti, rien d'envoyé : poster à la main est sans risque.
  assert.match(liveFailureReport(request, "discord-unreachable", "x", { siteGaveUp: true }), /peut être postée à la main sans doublon/);
  // Panne pendant l'envoi : elle a pu partir, aucune consigne de la poster.
  assert.doesNotMatch(liveFailureReport(request, "discord-down", "x"), /à la main/);
  assert.doesNotMatch(liveFailureReport(request, "discord-down", "x", { siteGaveUp: true }), /à la main/);
  // AutoMod : le texte bloqué n'est pas cité (le signalement serait bloqué aussi).
  const automod = liveFailureReport(request, "automod", "x");
  assert.match(automod, /une fois la règle corrigée, elle peut être postée à la main/);
  assert.doesNotMatch(automod, /Alpha contre Beta/);
  // Ni le texte ni le lien : une règle AutoMod peut viser les liens de diffusion.
  assert.doesNotMatch(automod, /twitch\.tv/);
  // Site parti puis AutoMod : la condition de la règle corrigée reste dite.
  assert.match(liveFailureReport(request, "automod", "x", { siteGaveUp: true }), /une fois la règle corrigée/);
});

test("liveFailureReport : poster à la main — avec la mention, et le texte entier s'il est raccourci", () => {
  const short = { message: "Alpha contre Beta", streamUrl: "https://twitch.tv/bg", context: "live-announce match-1" };
  const plain = liveFailureReport(short, "send-rejected", "x", { siteGaveUp: true });
  assert.match(plain, /avec la mention de tout le serveur en tête\./);
  assert.doesNotMatch(plain, /@everyone/);
  assert.doesNotMatch(plain, /raccourci/);
  const lines = Array.from({ length: 40 }, (_, i) => `• ${"A".repeat(30)}${i} contre ${"B".repeat(30)}${i}`);
  const long = { ...short, message: ["🔴 En direct — Coupe :", ...lines].join("\n") };
  const cut = liveFailureReport(long, "send-rejected", "x", { siteGaveUp: true });
  assert.ok(cut.length <= 1900 - "[AppBlueGenji] ".length);
  assert.match(cut, /texte cité raccourci ou absent : reprendre toutes les affiches depuis la fiche du tournoi, \/tournois\//);
  // AutoMod : rien n'est cité, le staff est renvoyé à la fiche du tournoi.
  assert.match(liveFailureReport(short, "automod", "x"), /reprendre toutes les affiches depuis la fiche du tournoi/);
});
