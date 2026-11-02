import test from "node:test";
import assert from "node:assert/strict";

import { Client, GatewayIntentBits, Message, MessagePayload, type MessageCreateOptions, type MessageTarget, type TextChannel } from "discord.js";

import { buildClientOptions } from "../../config/clientOptions.js";
import { liveAllowedMentions, STREAM_VIEWER_ROLE_ID } from "../../notifications/liveAnnouncement.js";
import { safeChannel } from "../../safe/safeChannel.js";
import { safeMsgReply } from "../../safe/safeMsgReply.js";

/**
 * Mentions par défaut du client : aucune. Les envois passent par la vraie
 * résolution de discord.js (`MessagePayload.resolveBody`), sans connexion,
 * pour lire le champ `allowed_mentions` qui partirait vers Discord.
 */

/** Texte qui, sans défaut, notifierait tout le serveur, un rôle et un membre. */
const MASS_MENTIONS = "# Developer Announcement Broadcast!\n> @everyone @here <@&100000000000000001> <@100000000000000002>";

/** Client réel jamais connecté : seules ses options servent. */
function offlineClient(): Client {
  return new Client(buildClientOptions());
}

/** Corps `allowed_mentions` que discord.js enverrait pour ces options. */
function resolvedMentions(client: Client, options: string | MessageCreateOptions): unknown {
  // `messages.resolveId` : lu seulement pour la référence d'une réponse.
  const target = { client, messages: { resolveId: (id: string) => id } } as unknown as MessageTarget;
  const payload = MessagePayload.create(target, options).resolveBody();
  return (payload.body as { allowed_mentions?: unknown }).allowed_mentions;
}

test("buildClientOptions_default_setsNoMentionsAndNoReplyPing", () => {
  const options = buildClientOptions();

  assert.deepEqual(options.allowedMentions, { parse: [], repliedUser: false });
  assert.deepEqual(options.intents, [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ]);
});

test("buildClientOptions_twoCalls_returnFreshObjects", () => {
  const first = buildClientOptions();
  const second = buildClientOptions();

  (first.allowedMentions?.parse as string[]).push("everyone");

  assert.deepEqual(second.allowedMentions, { parse: [], repliedUser: false });
});

test("clientDefault_sendWithoutAllowedMentions_resolvesToParseEmpty", () => {
  const client = offlineClient();

  const mentions = resolvedMentions(client, { content: MASS_MENTIONS });

  assert.deepEqual(mentions, { parse: [], replied_user: false });
});

test("safeChannel_broadcastText_sendsWithoutOverride", async () => {
  const client = offlineClient();
  const sent: MessageCreateOptions[] = [];
  const channel = {
    guild: { name: "Serveur" },
    send: async (options: MessageCreateOptions) => { sent.push(options); return {} as Message; },
  } as unknown as TextChannel;

  await safeChannel(client, channel, undefined, [], MASS_MENTIONS);

  assert.equal(sent.length, 1);
  assert.equal(sent[0].allowedMentions, undefined);
  assert.deepEqual(resolvedMentions(client, sent[0]), { parse: [], replied_user: false });
});

/**
 * Message de discord.js réel (son `reply` d'origine), sans cache : son salon
 * garde le contenu que `Message.reply` lui confie, prêt à résoudre.
 */
function repliableMessage(client: Client, sent: MessagePayload[]): Message {
  const message = Object.create(Message.prototype) as Message;
  Object.defineProperty(message, "client", { value: client });
  Object.defineProperty(message, "id", { value: "100000000000000003" });
  Object.defineProperty(message, "channel", {
    value: { send: async (payload: MessagePayload) => { sent.push(payload); return {}; } },
  });
  return message;
}

test("safeMsgReply_reply_doesNotPingAuthor", async () => {
  const client = offlineClient();
  const sent: MessagePayload[] = [];

  await safeMsgReply(client, repliableMessage(client, sent), "Your message has not been sent ! @everyone");

  assert.equal(sent.length, 1);
  const body = sent[0].resolveBody().body as { allowed_mentions?: unknown; message_reference?: { message_id: string } };
  assert.equal(body.message_reference?.message_id, "100000000000000003");
  assert.deepEqual(body.allowed_mentions, { parse: [], replied_user: false });
});

test("liveAnnouncement_officialChannel_overridesDefaultWithEveryone", () => {
  const client = offlineClient();

  const mentions = resolvedMentions(client, { content: "@everyone x", allowedMentions: liveAllowedMentions(undefined, true) });

  assert.deepEqual(mentions, { parse: ["everyone"], roles: [] });
});

test("liveAnnouncement_streamViewer_pingsOnlyThatRole", () => {
  const client = offlineClient();

  const mentions = resolvedMentions(client, {
    content: `<@&${STREAM_VIEWER_ROLE_ID}> x <@&100000000000000001>`,
    allowedMentions: liveAllowedMentions("stream-viewer", true),
  });

  assert.deepEqual(mentions, { parse: [], roles: [STREAM_VIEWER_ROLE_ID] });
});

test("liveAnnouncement_followUp_pingsNobody", () => {
  const client = offlineClient();

  const mentions = resolvedMentions(client, { content: "x", allowedMentions: liveAllowedMentions(undefined, false) });

  assert.deepEqual(mentions, { parse: [], roles: [] });
});
