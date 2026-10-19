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
  loggedLiveText,
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

test("isAllowedStreamUrl : ni page de redirection, ni autre adresse dans le lien", () => {
  for (const url of [
    "https://www.youtube.com/redirect?q=https://piege.example",
    "https://www.youtube.com/redirect?q=https%3A%2F%2Fpiege.example",
    "https://www.youtube.com/attribution_link?u=/watch%3Fv%3Dabc",
    "https://www.twitch.tv/bluegenji?r=https://piege.example",
    "https://www.twitch.tv/bluegenji#%E0%A4%A",
    "https://www.youtube.com/%72edirect?q=piege.example",
    "https://www.youtube.com//redirect?q=piege.example",
    "https://www.twitch.tv/bluegenji?next=https:%5C%5Cpiege.example",
    "https://www.twitch.tv/bluegenji?continue=%2F%2Fpiege.example",
    "https://www.twitch.tv/bluegenji?next=https%253A%252F%252Fpiege.example",
    "https://www.youtube.com/logout?continue=/%09/piege.example",
    "https://www.youtube.com/logout?continue=/%0D/piege.example",
  ]) {
    assert.equal(isAllowedStreamUrl(url), false, url);
  }
  assert.equal(isAllowedStreamUrl("https://www.youtube.com/watch?v=abc&t=60"), true);
  assert.equal(isAllowedStreamUrl("https://www.youtube.com/@BlueGenji/live"), true);
});

test("parseLiveAnnouncement : seul streamUrl est cliquable, le texte ne porte ni lien ni lien masqué", () => {
  const request = parseLiveAnnouncement({ ...REQUEST, message: "🔴 En direct : [Twitch](https://piege.example) contre https://piege.example — T" });
  assert.ok(request);
  assert.ok(!/:\/\//.test(request.message), request.message);
  assert.ok(!/\]\(/.test(request.message), request.message);
  assert.equal(request.message.replace(/\u200B/g, ""), "🔴 En direct : [Twitch](https://piege.example) contre https://piege.example — T");
});

test("parseLiveAnnouncement : ni message ni logMessage ne rendent une mention de membre, rôle ou salon", () => {
  const forged = "<@123456789012345678> contre <@!123456789012345678> — <@&123456789012345678> <#123456789012345678>";
  const request = parseLiveAnnouncement({ ...REQUEST, message: forged, logMessage: forged });
  assert.ok(request);
  for (const text of [request.message, request.logMessage ?? ""]) {
    assert.ok(!/<[@#]/.test(text), text);
    assert.equal(text.replace(/\u200B/g, ""), forged);
  }
  // Le texte du site, sans chevron, ne change pas.
  assert.equal(parseLiveAnnouncement({ ...REQUEST, message: "Alpha <3 contre Beta" })?.message, "Alpha <3 contre Beta");
});

test("parseLiveAnnouncement : un \\r ne fait pas de ligne hors de la citation du canal de logs", () => {
  const request = parseLiveAnnouncement({
    ...REQUEST,
    message: "Pseudo42 contre Beta\rAnnonce publiée\r\nfin",
    logMessage: "un joueur contre Beta\rAnnonce publiée, rien à faire\r\nfin",
  });
  assert.ok(request);
  assert.equal(request.message, "Pseudo42 contre Beta\nAnnonce publiée\nfin");
  assert.equal(request.logMessage, "un joueur contre Beta\nAnnonce publiée, rien à faire\nfin");
  const report = liveFailureReport(request, "no-send", "x");
  assert.ok(!report.includes("\r"), report);
  assert.ok(report.includes("> Annonce publiée, rien à faire\n"), report);
  assert.ok(!report.includes("Pseudo42"), report);
});

test("parseLiveAnnouncement : un lien ne transporte ni texte, ni lien masqué, ni mention", () => {
  // `new URL` accepte ces chaînes avec l'hôte www.twitch.tv : seule la forme
  // normalisée part, et une espace ou un saut de ligne font refuser le lien.
  for (const streamUrl of [
    "https://www.twitch.tv/x [Live officiel](https://piege.example/login)",
    "https://www.twitch.tv/x\n[Live officiel](https://piege.example/login)",
    "https://www.twitch.tv/x\t@everyone",
  ]) {
    assert.equal(parseLiveAnnouncement({ ...REQUEST, streamUrl }), null, JSON.stringify(streamUrl));
  }
  const hashed = parseLiveAnnouncement({ ...REQUEST, streamUrl: "https://twitch.tv/a#<@&123456789012345678>" });
  assert.ok(hashed);
  assert.equal(hashed.streamUrl, "https://twitch.tv/a#%3C@&123456789012345678%3E");
  assert.ok(!/[<>\s]/.test(hashed.streamUrl));
});

test("parseLiveAnnouncement : l'étiquette ne garde que les caractères du site", () => {
  const forged = parseLiveAnnouncement({ ...REQUEST, context: "x)\n[live-announce] annonce publiée (match-99 [Fiche](https://piege.example)" });
  assert.ok(forged);
  assert.ok(!/[\n()[\]:/.]/.test(forged.context), forged.context);
  const site = parseLiveAnnouncement({ ...REQUEST, context: "live-announce tournoi-7 match-12,13,…+4" });
  assert.equal(site?.context, "live-announce tournoi-7 match-12,13,…+4");
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
  assert.deepEqual(report, { posted: true, mentionEveryone: true, embedLinks: true, messageId: "m1", edited: false });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, LIVE_ANNOUNCE_CHANNEL_ID);
  assert.equal(LIVE_ANNOUNCE_CHANNEL_ID, "678961388030394401");
  assert.deepEqual(sent[0].allowedMentions, { parse: ["everyone"], roles: [] });
  assert.ok(sent[0].content.startsWith("@everyone "));
});

test("announceLive : sans la permission de mentionner, publie et le dit", async () => {
  const sent: Sent[] = [];
  const report = await announceLive(fakeClient({ sent, denied: [PermissionFlagsBits.MentionEveryone] }), REQUEST);
  assert.deepEqual(report, { posted: true, mentionEveryone: false, embedLinks: true, messageId: "m1", edited: false });
  assert.equal(sent.length, 1);
  // Ni mention écrite (elle s'afficherait en gris sans notifier), ni mention autorisée.
  assert.ok(!sent[0].content.includes("@everyone"));
  assert.deepEqual(sent[0].allowedMentions, { parse: [], roles: [] });
});

test("announceLive : sans « Intégrer des liens », publie et le dit", async () => {
  const sent: Sent[] = [];
  const report = await announceLive(fakeClient({ sent, denied: [PermissionFlagsBits.EmbedLinks] }), REQUEST);
  assert.deepEqual(report, { posted: true, mentionEveryone: true, embedLinks: false, messageId: "m1", edited: false });
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
  assert.match(cut, /texte cité raccourci, sans pseudo ou absent : reprendre toutes les affiches depuis la fiche du tournoi, \/tournois\//);
  // AutoMod : rien n'est cité, le staff est renvoyé à la fiche du tournoi.
  assert.match(liveFailureReport(short, "automod", "x"), /reprendre toutes les affiches depuis la fiche du tournoi/);
});

test("parseLiveAnnouncement : logMessage facultatif, validé comme message", () => {
  // Absent : rien n'est ajouté, message sera cité.
  const plain = parseLiveAnnouncement(REQUEST);
  assert.ok(plain);
  assert.equal("logMessage" in plain, false);
  assert.equal(loggedLiveText(plain), REQUEST.message);
  // Présent : normalisé comme message (espaces, mentions, liens, longueur).
  const withLog = parseLiveAnnouncement({
    ...REQUEST,
    message: "Pseudo42 contre Beta",
    logMessage: "  un joueur contre Beta @everyone https://piege.example " + "x".repeat(5000),
  });
  assert.ok(withLog);
  assert.equal(withLog.message, "Pseudo42 contre Beta");
  assert.ok(withLog.logMessage?.startsWith("un joueur contre Beta @\u200Beveryone https:\u200B//piege.example"));
  assert.equal(withLog.logMessage?.length, MAX_LIVE_MESSAGE_LENGTH);
  assert.ok(withLog.logMessage?.endsWith("…"));
  assert.equal(loggedLiveText(withLog), withLog.logMessage);
  // Invalide : toute la demande est refusée, plutôt que de citer le pseudo.
  for (const logMessage of ["", "   ", 42, null, ["un joueur"], { text: "un joueur" }]) {
    assert.equal(parseLiveAnnouncement({ ...REQUEST, logMessage }), null, JSON.stringify(logMessage));
  }
});

test("liveFailureReport : cite logMessage, jamais le pseudo de message", () => {
  const request = {
    message: "Pseudo42 contre Beta — Coupe",
    logMessage: "un joueur contre Beta — Coupe",
    streamUrl: "https://twitch.tv/bg",
    context: "live-announce match-1",
  };
  for (const key of ["no-send", "send-denied", "send-rejected", "missing", "discord-unreachable", "discord-down", "failed"]) {
    for (const siteGaveUp of [false, true]) {
      const report = liveFailureReport(request, key, "x", { siteGaveUp });
      assert.match(report, /\n> un joueur contre Beta — Coupe\n<https:\/\/twitch\.tv\/bg>$/, `${key} ${siteGaveUp}`);
      assert.doesNotMatch(report, /Pseudo42/, `${key} ${siteGaveUp}`);
    }
  }
  // La citation sans pseudo n'est pas le texte publié : un repost manuel
  // reprend les affiches depuis la fiche du tournoi.
  const gaveUp = liveFailureReport(request, "send-rejected", "x", { siteGaveUp: true });
  assert.match(gaveUp, /postée à la main sans doublon, avec la mention de tout le serveur en tête \(texte cité raccourci, sans pseudo ou absent : reprendre toutes les affiches depuis la fiche du tournoi/);
  // Version de journal identique au texte, entière : pas de renvoi.
  const same = { ...request, message: request.logMessage };
  assert.doesNotMatch(liveFailureReport(same, "send-rejected", "x", { siteGaveUp: true }), /fiche du tournoi/);
  // AutoMod : rien n'est cité, ni l'un ni l'autre.
  const automod = liveFailureReport(request, "automod", "x");
  assert.doesNotMatch(automod, /Pseudo42|un joueur/);
  // Une version de journal longue est raccourcie comme le serait message.
  const lines = Array.from({ length: 40 }, (_, i) => `• ${"A".repeat(30)}${i} contre un joueur`);
  const long = { ...request, logMessage: lines.join("\n") };
  const cut = liveFailureReport(long, "send-rejected", "x", { siteGaveUp: true });
  assert.ok(cut.length <= 1900 - "[AppBlueGenji] ".length);
  assert.match(cut, /texte cité raccourci, sans pseudo ou absent/);
  assert.doesNotMatch(cut, /Pseudo42/);
  // Sans logMessage : message est cité.
  const withoutLog = { message: request.message, streamUrl: request.streamUrl, context: request.context };
  assert.match(liveFailureReport(withoutLog, "no-send", "x"), /> Pseudo42 contre Beta — Coupe/);
});

test("announceLive : #live publie message, jamais logMessage", async () => {
  const sent: Sent[] = [];
  const request = parseLiveAnnouncement({ ...REQUEST, message: "Pseudo42 contre Beta", logMessage: "un joueur contre Beta" });
  assert.ok(request);
  await announceLive(fakeClient({ sent }), request);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].content, "@everyone Pseudo42 contre Beta\nhttps://www.twitch.tv/bluegenji");
  // Le jeton d'unicité ne dépend pas de logMessage : un même envoi rejoué reste reconnu.
  assert.equal(sent[0].nonce, liveAnnouncementNonce({ ...REQUEST, message: "Pseudo42 contre Beta" }));
});
