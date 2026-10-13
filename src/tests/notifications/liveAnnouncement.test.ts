import test from "node:test";
import assert from "node:assert/strict";
import { PermissionFlagsBits, type Client } from "discord.js";
import {
  announceLive,
  formatLiveAnnouncement,
  isAllowedStreamUrl,
  LIVE_ANNOUNCE_CHANNEL_ID,
  LiveChannelUnavailableError,
  parseLiveAnnouncement,
} from "../../notifications/liveAnnouncement.js";
import { MAX_MESSAGE_LENGTH } from "../../notifications/notifications.js";

/**
 * Annonce de live (`POST /internal/announce/live`) : validation du corps, texte
 * publié, mention `@everyone` autorisée pour ce seul envoi, et refus quand le
 * salon est fermé au bot. Discord est simulé : rien ne part.
 */

type Sent = { channelId: string; content: string; allowedMentions: unknown };

function fakeClient(options: {
  sent: Sent[];
  channel?: "missing" | "throw" | "send-fails";
  denied?: bigint[];
}): Client {
  return {
    user: { id: "bot" },
    channels: {
      fetch: async (id: string) => {
        if (options.channel === "throw") { throw new Error("Missing Access"); }
        if (options.channel === "missing") { return null; }
        return {
          permissionsFor: () => ({ has: (flag: bigint) => !(options.denied ?? []).includes(flag) }),
          send: async (payload: { content: string; allowedMentions: unknown }) => {
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

test("announceLive : publie dans #live, @everyone autorisé pour ce seul message", async () => {
  const sent: Sent[] = [];
  const report = await announceLive(fakeClient({ sent }), REQUEST);
  assert.deepEqual(report, { posted: true, mentionEveryone: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].channelId, LIVE_ANNOUNCE_CHANNEL_ID);
  assert.equal(LIVE_ANNOUNCE_CHANNEL_ID, "678961388030394401");
  assert.deepEqual(sent[0].allowedMentions, { parse: ["everyone"] });
  assert.ok(sent[0].content.startsWith("@everyone "));
});

test("announceLive : sans la permission de mentionner, publie et le dit", async () => {
  const sent: Sent[] = [];
  const report = await announceLive(fakeClient({ sent, denied: [PermissionFlagsBits.MentionEveryone] }), REQUEST);
  assert.deepEqual(report, { posted: true, mentionEveryone: false });
  assert.equal(sent.length, 1);
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
