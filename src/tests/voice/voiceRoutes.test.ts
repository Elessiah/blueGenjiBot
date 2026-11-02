import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

import { startInternalApi } from "../../internalApi.js";
import { getBddInstance, resetBddInstance } from "../../bdd/Bdd.js";
import { DEFAULT_VOICE_CATEGORY_ID, resetVoiceState } from "../../voice/matchVoice.js";
import { addVoice, discordError, fakeVoiceClient, resetWorld, world } from "./fakeVoiceClient.js";

/**
 * Contrat site ↔ bot des routes `/internal/voice/*` : vraies requêtes HTTP
 * sur `startInternalApi`, base jetable, client Discord simulé.
 */

const TMP_DIR = path.join(os.tmpdir(), `bgenji-voice-routes-${randomUUID()}`);
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "900000000000000001";
process.env.INFO_SERV = "800000000000000001";
process.env.INTERNAL_API_PORT = "0";
process.env.INTERNAL_API_HOST = "127.0.0.1";
process.env.INTERNAL_API_TOKEN = "jeton-de-test";
delete process.env.VOICE_CATEGORY_ID;

const TOKEN = "jeton-de-test";
const UNTRACKED = "400000000000000001";
const client = fakeVoiceClient(DEFAULT_VOICE_CATEGORY_ID, process.env.INFO_SERV);

let server: Server;
let baseUrl: string;

test.before(async () => {
  server = startInternalApi(client);
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.beforeEach(async () => {
  resetWorld();
  resetVoiceState();
  await (await getBddInstance()).raw("DELETE FROM MatchVoiceChannel");
});

test.after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await resetBddInstance();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

type Reply = { status: number; body: Record<string, unknown> };

async function call(route: string, options: { method?: string; body?: unknown; token?: string | null } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  const token = options.token === undefined ? TOKEN : options.token;
  if (token !== null) { headers["x-internal-token"] = token; }
  if (options.body !== undefined) { headers["content-type"] = "application/json"; }
  const response = await fetch(baseUrl + route, {
    method: options.method ?? (options.body === undefined ? "GET" : "POST"),
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

const create = (body: unknown, token?: string | null): Promise<Reply> =>
  call("/internal/voice/channels", { body, token });

test("createVoiceChannel_noToken_returns401", async () => {
  const reply = await create({ key: "match:1:team:2", name: "Les Genji" }, null);
  assert.equal(reply.status, 401);
  assert.deepEqual(world.creations, []);
});

test("countVoiceChannel_wrongToken_returns401", async () => {
  const reply = await call(`/internal/voice/channels/${UNTRACKED}/count`, { token: "faux" });
  assert.equal(reply.status, 401);
});

test("releaseVoiceChannel_noToken_returns401", async () => {
  const reply = await call(`/internal/voice/channels/${UNTRACKED}/release`, { method: "POST", token: null });
  assert.equal(reply.status, 401);
});

test("createVoiceChannel_invalidKey_returns400", async () => {
  const reply = await create({ key: "match 1", name: "Les Genji" });
  assert.deepEqual(reply, { status: 400, body: { error: "INVALID_VOICE_KEY" } });
});

test("createVoiceChannel_missingName_returns400", async () => {
  const reply = await create({ key: "match:1:team:2" });
  assert.deepEqual(reply, { status: 400, body: { error: "INVALID_VOICE_CHANNEL_NAME" } });
});

test("createVoiceChannel_firstCall_returns201WithChannelId", async () => {
  const reply = await create({ key: "match:1:team:2", name: "**Les Genji**" });

  assert.equal(reply.status, 201);
  assert.deepEqual(Object.keys(reply.body), ["channelId"]);
  assert.equal(world.creations[0].name, "Les Genji");
});

test("createVoiceChannel_sameKeyAgain_returns200WithSameChannel", async () => {
  const first = await create({ key: "match:1:team:2", name: "Les Genji" });
  const second = await create({ key: "match:1:team:2", name: "Les Genji" });

  assert.equal(second.status, 200);
  assert.deepEqual(second.body, first.body);
});

test("createVoiceChannel_missingPermissions_returns503", async () => {
  world.createError = discordError(50013, "Missing Permissions");
  const reply = await create({ key: "match:1:team:2", name: "Les Genji" });
  assert.deepEqual(reply, { status: 503, body: { error: "VOICE_MISSING_PERMISSIONS" } });
});

test("createVoiceChannel_categoryMissing_returns503", async () => {
  world.category = "missing";
  const reply = await create({ key: "match:1:team:2", name: "Les Genji" });
  assert.deepEqual(reply, { status: 503, body: { error: "VOICE_CATEGORY_UNAVAILABLE" } });
});

test("createVoiceChannel_clientNotReady_returns503", async () => {
  world.ready = false;
  const reply = await create({ key: "match:1:team:2", name: "Les Genji" });
  assert.deepEqual(reply, { status: 503, body: { error: "DISCORD_NOT_READY" } });
});

test("countVoiceChannel_invalidId_returns400", async () => {
  const reply = await call("/internal/voice/channels/abc/count");
  assert.deepEqual(reply, { status: 400, body: { error: "INVALID_CHANNEL_ID" } });
});

test("countVoiceChannel_trackedChannel_returnsMembersOnly", async () => {
  const { body } = await create({ key: "match:1:team:2", name: "Les Genji" });
  const channelId = String(body.channelId);
  world.voices.get(channelId)!.members.size = 4;

  const reply = await call(`/internal/voice/channels/${channelId}/count`);

  assert.deepEqual(reply, { status: 200, body: { members: 4 } });
});

test("countVoiceChannel_untrackedChannel_returns404", async () => {
  addVoice(UNTRACKED, 5, DEFAULT_VOICE_CATEGORY_ID);
  const reply = await call(`/internal/voice/channels/${UNTRACKED}/count`);
  assert.deepEqual(reply, { status: 404, body: { error: "VOICE_CHANNEL_NOT_TRACKED" } });
});

test("countVoiceChannel_deletedByHand_returns404NotFound", async () => {
  const { body } = await create({ key: "match:1:team:2", name: "Les Genji" });
  world.voices.delete(String(body.channelId));

  const reply = await call(`/internal/voice/channels/${String(body.channelId)}/count`);

  assert.deepEqual(reply, { status: 404, body: { error: "VOICE_CHANNEL_NOT_FOUND" } });
});

test("releaseVoiceChannel_invalidId_returns400", async () => {
  const reply = await call("/internal/voice/channels/12/release", { method: "POST" });
  assert.deepEqual(reply, { status: 400, body: { error: "INVALID_CHANNEL_ID" } });
});

test("releaseVoiceChannel_emptyChannel_returnsDeletedTrue", async () => {
  const { body } = await create({ key: "match:1:team:2", name: "Les Genji" });

  const reply = await call(`/internal/voice/channels/${String(body.channelId)}/release`, { method: "POST" });

  assert.deepEqual(reply, { status: 200, body: { released: true, deleted: true } });
  assert.deepEqual(world.deletions, [body.channelId]);
});

test("releaseVoiceChannel_occupiedChannel_returnsDeletedFalse", async () => {
  const { body } = await create({ key: "match:1:team:2", name: "Les Genji" });
  world.voices.get(String(body.channelId))!.members.size = 3;

  const reply = await call(`/internal/voice/channels/${String(body.channelId)}/release`, { method: "POST" });

  assert.deepEqual(reply, { status: 200, body: { released: true, deleted: false } });
});

test("releaseVoiceChannel_untrackedChannel_returns404AndNothingDeleted", async () => {
  addVoice(UNTRACKED, 0, DEFAULT_VOICE_CATEGORY_ID);

  const reply = await call(`/internal/voice/channels/${UNTRACKED}/release`, { method: "POST" });

  assert.deepEqual(reply, { status: 404, body: { error: "VOICE_CHANNEL_NOT_TRACKED" } });
  assert.deepEqual(world.deletions, []);
});

test("countVoiceChannel_discordFails_returns502AndLogsWithoutMembers", async () => {
  const { body } = await create({ key: "match:1:team:2", name: "Les Genji" });
  world.fetchVoiceError = new Error("socket hang up");

  const reply = await call(`/internal/voice/channels/${String(body.channelId)}/count`);

  assert.deepEqual(reply, { status: 502, body: { error: "VOICE_DISCORD_ERROR" } });
  assert.equal(world.logs.length, 1);
  assert.match(world.logs[0], /VOICE_DISCORD_ERROR/);
});
