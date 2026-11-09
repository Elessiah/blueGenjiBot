import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { ChannelType, type VoiceState } from "discord.js";

import { getBddInstance, resetBddInstance } from "../../bdd/Bdd.js";
import {
  ABANDONED_MAX_AGE_MS,
  DEFAULT_VOICE_CATEGORY_ID,
  FALLBACK_VOICE_LABEL,
  FALLBACK_VOICE_NAME,
  RELEASED_MAX_AGE_MS,
  UNRELEASED_MAX_AGE_MS,
  VOICE_SWEEP_CRON,
  VOICE_USER_LIMIT,
  VoiceChannelError,
  ensureTeamVoiceChannel,
  handleVoiceChannelDeleted,
  handleVoiceStateUpdate,
  parseChannelId,
  parseVoiceKey,
  releaseVoiceChannel,
  releaseVoiceChannelByKey,
  resetVoiceState,
  sanitizeVoiceChannelName,
  shouldSweep,
  sweepVoiceChannels,
  voiceCategoryId,
  voiceChannelName,
  voiceErrorDetail,
} from "../../voice/matchVoice.js";
import { addVoice, discordError, fakeVoiceClient, resetWorld, world } from "./fakeVoiceClient.js";

/**
 * Salons vocaux d'équipe (MATCH-VOICE) : création idempotente, compte,
 * libération, départs, salons supprimés à la main et balayages, sur une base
 * SQLite jetable et un client Discord simulé.
 */

const TMP_DIR = path.join(os.tmpdir(), `bgenji-match-voice-${randomUUID()}`);
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "900000000000000001";
process.env.INFO_SERV = "800000000000000001";
delete process.env.VOICE_CATEGORY_ID;

const CATEGORY = DEFAULT_VOICE_CATEGORY_ID;
const client = fakeVoiceClient(CATEGORY, process.env.INFO_SERV);
const KEY = "match:12:team:34";
const HOUR = 60 * 60 * 1000;
const T0 = 1_800_000_000_000;
/** Une autre catégorie du serveur (archive, staff). */
const OTHER_CATEGORY = "123456789012345678";

/** Lignes suivies, par identifiant de salon. */
async function tracked(): Promise<{ channel_id: string; voice_key: string; released_at: number | null }[]> {
  const bdd = await getBddInstance();
  return bdd.raw("SELECT channel_id, voice_key, released_at FROM MatchVoiceChannel ORDER BY channel_id");
}

/** Inscrit directement un salon au suivi. */
async function track(channelId: string, key: string, createdAt: number, releasedAt: number | null): Promise<void> {
  const bdd = await getBddInstance();
  await bdd.raw(
    "INSERT INTO MatchVoiceChannel (channel_id, voice_key, created_at, released_at) VALUES (?, ?, ?, ?)",
    [channelId, key, createdAt, releasedAt],
  );
}

/** État vocal « avant » d'un départ du salon. */
function leftFrom(channel: unknown, channelId: string): Pick<VoiceState, "channelId" | "channel"> {
  return { channelId, channel } as unknown as Pick<VoiceState, "channelId" | "channel">;
}

/** Attend le rejet d'une `VoiceChannelError` de ce code. */
async function rejectsWith(promise: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(promise, (error: unknown) => error instanceof VoiceChannelError && error.code === code);
}

test.beforeEach(async () => {
  resetWorld();
  resetVoiceState();
  delete process.env.VOICE_CATEGORY_ID;
  const bdd = await getBddInstance();
  await bdd.raw("DELETE FROM MatchVoiceChannel");
});

test.after(async () => {
  await resetBddInstance();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

// --- Validation ------------------------------------------------------------

test("sanitizeVoiceChannelName_plainName_keptAsIs", () => {
  assert.equal(sanitizeVoiceChannelName("Les Genji Bleus"), "Les Genji Bleus");
});

test("sanitizeVoiceChannelName_mentionsAndMarkdown_stripped", () => {
  assert.equal(sanitizeVoiceChannelName("@everyone **<@123>** _x_ `y` ~z~ |w| # \\v"), "everyone 123 x y z w v");
});

test("sanitizeVoiceChannelName_controlAndInvisibleChars_collapsedToOneSpace", () => {
  assert.equal(sanitizeVoiceChannelName("Team\n​Alpha\t  Bravo"), "Team Alpha Bravo");
});

test("sanitizeVoiceChannelName_100CodePoints_kept", () => {
  const name = "é".repeat(100);
  assert.equal(sanitizeVoiceChannelName(name), name);
});

test("sanitizeVoiceChannelName_101CodePoints_cutTo100WithoutSplittingEmoji", () => {
  const name = "a".repeat(99) + "🎮🎮";
  assert.equal(sanitizeVoiceChannelName(name), "a".repeat(99) + "🎮");
});

test("sanitizeVoiceChannelName_zwjEmojiAndBidiOverride_emojiKeptOverrideRemoved", () => {
  assert.equal(sanitizeVoiceChannelName("Team \u202Eabc 👨\u200D👩\u200D👧"), "Team abc 👨\u200D👩\u200D👧");
});

test("sanitizeVoiceChannelName_onlyStrippedChars_fallbackName", () => {
  assert.equal(sanitizeVoiceChannelName("@@**__"), FALLBACK_VOICE_NAME);
});

test("sanitizeVoiceChannelName_200Chars_accepted", () => {
  assert.equal(sanitizeVoiceChannelName("a".repeat(200)), "a".repeat(100));
});

test("sanitizeVoiceChannelName_201Chars_rejected", () => {
  assert.equal(sanitizeVoiceChannelName("a".repeat(201)), null);
});

test("sanitizeVoiceChannelName_blankOrNonString_rejected", () => {
  assert.equal(sanitizeVoiceChannelName("   "), null);
  assert.equal(sanitizeVoiceChannelName(42), null);
  assert.equal(sanitizeVoiceChannelName(undefined), null);
});

test("parseVoiceKey_siteKey_accepted", () => {
  assert.equal(parseVoiceKey("match:12:team:34"), "match:12:team:34");
});

test("parseVoiceKey_100Chars_accepted", () => {
  assert.equal(parseVoiceKey("k".repeat(100)), "k".repeat(100));
});

test("parseVoiceKey_101Chars_rejected", () => {
  assert.equal(parseVoiceKey("k".repeat(101)), null);
});

test("parseVoiceKey_forbiddenCharOrEmptyOrNonString_rejected", () => {
  assert.equal(parseVoiceKey("match 12"), null);
  assert.equal(parseVoiceKey("match/12"), null);
  assert.equal(parseVoiceKey(""), null);
  assert.equal(parseVoiceKey(12), null);
});

test("parseChannelId_17And20Digits_accepted", () => {
  assert.equal(parseChannelId("1".repeat(17)), "1".repeat(17));
  assert.equal(parseChannelId("1".repeat(20)), "1".repeat(20));
});

test("parseChannelId_16Or21DigitsOrLetters_rejected", () => {
  assert.equal(parseChannelId("1".repeat(16)), null);
  assert.equal(parseChannelId("1".repeat(21)), null);
  assert.equal(parseChannelId("12345678901234567a"), null);
});

test("voiceCategoryId_unset_defaultCategory", () => {
  assert.equal(voiceCategoryId(), "676735851119640577");
});

test("voiceCategoryId_validEnv_used", () => {
  process.env.VOICE_CATEGORY_ID = "123456789012345678";
  assert.equal(voiceCategoryId(), "123456789012345678");
});

test("voiceCategoryId_invalidEnv_defaultCategory", () => {
  process.env.VOICE_CATEGORY_ID = "pas-un-id";
  assert.equal(voiceCategoryId(), DEFAULT_VOICE_CATEGORY_ID);
});

// --- Création --------------------------------------------------------------

test("ensureTeamVoiceChannel_newKey_createsLimitedVoiceInCategoryAndTracksIt", async () => {
  const result = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);

  assert.equal(result.created, true);
  assert.equal(world.creations.length, 1);
  const options = world.creations[0];
  assert.equal(options.name, "Les Genji");
  assert.equal(options.type, ChannelType.GuildVoice);
  assert.equal(options.parent, CATEGORY);
  assert.equal(options.userLimit, VOICE_USER_LIMIT);
  assert.equal(options.permissionOverwrites, undefined);
  assert.deepEqual(await tracked(), [{ channel_id: result.channelId, voice_key: KEY, released_at: null }]);
});

test("ensureTeamVoiceChannel_sameKeyTwice_sameChannelWithoutSecondCreation", async () => {
  const first = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  const second = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);

  assert.deepEqual(second, { channelId: first.channelId, created: false });
  assert.equal(world.creations.length, 1);
});

test("ensureTeamVoiceChannel_concurrentSameKey_singleCreation", async () => {
  const [a, b] = await Promise.all([
    ensureTeamVoiceChannel(client, KEY, "Les Genji", T0),
    ensureTeamVoiceChannel(client, KEY, "Les Genji", T0),
  ]);

  assert.equal(a.channelId, b.channelId);
  assert.equal(world.creations.length, 1);
});

test("ensureTeamVoiceChannel_channelDeletedByHand_recreatedAndOldOneUntracked", async () => {
  const first = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  world.voices.delete(first.channelId);

  const second = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);

  assert.equal(second.created, true);
  assert.notEqual(second.channelId, first.channelId);
  assert.deepEqual((await tracked()).map((row) => row.channel_id), [second.channelId]);
});

test("ensureTeamVoiceChannel_releasedButStillThere_reclaimedAndNoLongerReleased", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  world.voices.get(channelId)!.members.size = 2;
  await releaseVoiceChannel(client, channelId, T0);

  const again = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  const voice = world.voices.get(channelId)!;
  voice.members.size = 0;
  await handleVoiceStateUpdate(client, leftFrom(voice, channelId));

  assert.deepEqual(again, { channelId, created: false });
  assert.equal((await tracked())[0].released_at, null);
  assert.deepEqual(world.deletions, []);
});

test("ensureTeamVoiceChannel_categoryUnknown_categoryUnavailable", async () => {
  world.category = "missing";
  await rejectsWith(ensureTeamVoiceChannel(client, KEY, "Les Genji", T0), "VOICE_CATEGORY_UNAVAILABLE");
  assert.deepEqual(await tracked(), []);
});

test("ensureTeamVoiceChannel_categoryUnknown_messageNamesCategoryId", async () => {
  // L'identifiant de la catégorie est de la configuration : il dit laquelle manque.
  world.category = "missing";
  await assert.rejects(ensureTeamVoiceChannel(client, KEY, "Les Genji", T0), {
    name: "VoiceChannelError",
    message: `catégorie introuvable (${CATEGORY})`,
  });
});

test("ensureTeamVoiceChannel_categoryIsNotACategory_categoryUnavailable", async () => {
  world.category = "text";
  await rejectsWith(ensureTeamVoiceChannel(client, KEY, "Les Genji", T0), "VOICE_CATEGORY_UNAVAILABLE");
});

test("ensureTeamVoiceChannel_missingPermissions_errorCodeAndSingleAlert", async () => {
  world.createError = discordError(50013, "Missing Permissions");

  await rejectsWith(ensureTeamVoiceChannel(client, KEY, "Les Genji", T0), "VOICE_MISSING_PERMISSIONS");
  await rejectsWith(ensureTeamVoiceChannel(client, "match:12:team:35", "Autre", T0), "VOICE_MISSING_PERMISSIONS");

  assert.equal(world.logs.length, 1);
  assert.match(world.logs[0], /Gérer les salons/);
  assert.match(world.logs[0], new RegExp(CATEGORY));
  assert.deepEqual(await tracked(), []);
});

test("ensureTeamVoiceChannel_otherDiscordError_discordErrorWithoutAlert", async () => {
  world.createError = discordError(50035, "Invalid Form Body");

  await rejectsWith(ensureTeamVoiceChannel(client, KEY, "Les Genji", T0), "VOICE_DISCORD_ERROR");
  assert.deepEqual(world.logs, []);
});

test("voiceErrorDetail_discordError_returnsKindAndCodeOnly", () => {
  assert.equal(voiceErrorDetail(discordError(50035, "Invalid Form Body name: Equipe Bleue")), "Error, code 50035");
});

test("voiceErrorDetail_codeWithSpaces_returnsUnknownCode", () => {
  assert.equal(voiceErrorDetail(Object.assign(new Error("x"), { code: "texte d'un joueur" })), "Error, code inconnu");
});

test("voiceErrorDetail_fetchFailedWithCauseCode_returnsCauseCodeAndNetwork", () => {
  const error = new TypeError("fetch failed", { cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }) });

  assert.equal(voiceErrorDetail(error), "TypeError, code ECONNRESET, réseau");
});

test("voiceErrorDetail_abortError_namesAbortErrorNotDiscordRefusal", () => {
  const error = new DOMException("This operation was aborted", "AbortError");

  assert.equal(voiceErrorDetail(error), "AbortError, code 20");
});

test("voiceErrorDetail_voiceChannelErrorWithoutContext_returnsCodeOnce", () => {
  assert.equal(voiceErrorDetail(new VoiceChannelError("VOICE_STORAGE_ERROR")), "VOICE_STORAGE_ERROR");
});

test("VoiceChannelError_subjectIdNotSnowflake_subjectIgnored", () => {
  const error = new VoiceChannelError("VOICE_CATEGORY_UNAVAILABLE", "catégorie introuvable", undefined, "Equipe Bleue");

  assert.equal(error.message, "catégorie introuvable");
});

test("voiceChannelName_regularName_returnsNameUnchanged", () => {
  assert.equal(voiceChannelName(KEY, "Les Genji"), "Les Genji");
});

test("voiceChannelName_fallbackName_returnsBilingualLabelWithTeamNumber", () => {
  assert.equal(voiceChannelName(KEY, FALLBACK_VOICE_NAME), "Salon d'équipe / Team channel 34");
});

test("voiceChannelName_fallbackKeyWithoutTeam_returnsBilingualLabelOnly", () => {
  assert.equal(voiceChannelName("tournoi-7", FALLBACK_VOICE_NAME), FALLBACK_VOICE_LABEL);
});

test("ensureTeamVoiceChannel_discordRateLimited_discordUnavailable503", async () => {
  world.createError = Object.assign(new Error("You are being rate limited"), { status: 429 });

  await assert.rejects(ensureTeamVoiceChannel(client, KEY, "Les Genji", T0), (error: unknown) =>
    error instanceof VoiceChannelError && error.code === "VOICE_DISCORD_UNAVAILABLE" && error.status === 503);
});

test("ensureTeamVoiceChannel_discordServerError_discordUnavailable", async () => {
  world.createError = Object.assign(new Error("Internal Server Error"), { status: 502 });

  await rejectsWith(ensureTeamVoiceChannel(client, KEY, "Les Genji", T0), "VOICE_DISCORD_UNAVAILABLE");
});

test("voiceErrorDetail_errorWithStatus_appendsStatus", () => {
  // Limite de débit de Discord : le statut distingue un 429 d'une panne.
  const error = Object.assign(new Error("You are being rate limited"), { status: 429 });

  assert.equal(voiceErrorDetail(error), "Error, code inconnu, statut 429");
});

test("voiceErrorDetail_voiceChannelError_returnsCodeAndContext", () => {
  assert.equal(voiceErrorDetail(new VoiceChannelError("VOICE_CATEGORY_UNAVAILABLE", "catégorie introuvable", undefined, CATEGORY)),
    `VOICE_CATEGORY_UNAVAILABLE (catégorie introuvable (${CATEGORY}))`);
});

test("VoiceChannelError_causeWithMessage_messageHasContextAndCodeOnly", () => {
  const error = new VoiceChannelError("VOICE_DISCORD_ERROR", "création du salon", discordError(50035, "Invalid Form Body name: Equipe Bleue"));

  assert.equal(error.message, "création du salon : Error, code 50035");
});

test("voiceErrorDetail_noCode_returnsUnknownCode", () => {
  assert.equal(voiceErrorDetail(new Error("UNIQUE constraint failed: Equipe Bleue")), "Error, code inconnu");
});

test("releaseVoiceChannelByKey_trackedKey_emptyChannelDeletedAndUntracked", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);

  await releaseVoiceChannelByKey(client, KEY, T0);

  assert.deepEqual(world.deletions, [channelId]);
  assert.deepEqual(await tracked(), []);
});

test("releaseVoiceChannelByKey_concurrentEnsure_waitsForReleaseThenCreatesNewChannel", async () => {
  // Lecture et libération sous un seul verrou : une reprise de la clé ne se glisse pas entre
  // les deux (elle rendrait au site un salon supprimé juste après).
  const { channelId: first } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);

  const released = releaseVoiceChannelByKey(client, KEY, T0);
  const ensured = ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  await released;
  const second = await ensured;

  assert.deepEqual(world.deletions, [first]);
  assert.equal(second.created, true);
  assert.notEqual(second.channelId, first);
  assert.deepEqual(await tracked(), [{ channel_id: second.channelId, voice_key: KEY, released_at: null }]);
});

test("releaseVoiceChannelByKey_unknownKey_resolvesWithoutDeleting", async () => {
  addVoice("400000000000000003", 0, CATEGORY);

  await releaseVoiceChannelByKey(client, KEY, T0);

  assert.deepEqual(world.deletions, []);
});

// --- Libération ------------------------------------------------------------

test("releaseVoiceChannel_emptyChannel_deletedAtOnceAndUntracked", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);

  assert.deepEqual(await releaseVoiceChannel(client, channelId, T0), { deleted: true });
  assert.deepEqual(world.deletions, [channelId]);
  assert.deepEqual(await tracked(), []);
});

test("releaseVoiceChannel_occupiedChannel_keptAndMarkedReleased", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  world.voices.get(channelId)!.members.size = 2;

  assert.deepEqual(await releaseVoiceChannel(client, channelId, T0 + HOUR), { deleted: false });
  assert.deepEqual(world.deletions, []);
  assert.equal(Number((await tracked())[0].released_at), T0 + HOUR);
});

test("releaseVoiceChannel_releasedTwice_firstReleaseTimeKept", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  world.voices.get(channelId)!.members.size = 2;
  await releaseVoiceChannel(client, channelId, T0 + HOUR);

  await releaseVoiceChannel(client, channelId, T0 + 5 * HOUR);

  assert.equal(Number((await tracked())[0].released_at), T0 + HOUR);
});

test("releaseVoiceChannel_untrackedChannel_deletedTrueAndNeverDeleted", async () => {
  addVoice("400000000000000002", 0, CATEGORY);

  assert.deepEqual(await releaseVoiceChannel(client, "400000000000000002", T0), { deleted: true });
  assert.ok(world.voices.has("400000000000000002"));
  assert.deepEqual(world.deletions, []);
});

test("releaseVoiceChannel_releasedTwiceAfterDeletion_secondCallSucceeds", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  await releaseVoiceChannel(client, channelId, T0);

  const replay = await releaseVoiceChannel(client, channelId, T0 + HOUR);

  assert.deepEqual(replay, { deleted: true });
  assert.deepEqual(world.deletions, [channelId]);
});

test("releaseVoiceChannel_channelAlreadyGone_deletedAndUntracked", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  world.voices.delete(channelId);

  assert.deepEqual(await releaseVoiceChannel(client, channelId, T0), { deleted: true });
  assert.deepEqual(await tracked(), []);
});

test("releaseVoiceChannel_deleteMissingPermissions_errorCodeAndRowKept", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  world.deleteError = discordError(50013, "Missing Permissions");

  await rejectsWith(releaseVoiceChannel(client, channelId, T0), "VOICE_MISSING_PERMISSIONS");
  assert.equal((await tracked()).length, 1);
});

// --- Départs et suppressions à la main ------------------------------------

test("handleVoiceStateUpdate_releasedChannelEmptied_deleted", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  const voice = world.voices.get(channelId)!;
  voice.members.size = 1;
  await releaseVoiceChannel(client, channelId, T0);

  voice.members.size = 0;
  await handleVoiceStateUpdate(client, leftFrom(voice, channelId));

  assert.deepEqual(world.deletions, [channelId]);
  assert.deepEqual(await tracked(), []);
});

test("handleVoiceStateUpdate_releasedChannelStillOccupied_kept", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  const voice = world.voices.get(channelId)!;
  voice.members.size = 2;
  await releaseVoiceChannel(client, channelId, T0);

  voice.members.size = 1;
  await handleVoiceStateUpdate(client, leftFrom(voice, channelId));

  assert.deepEqual(world.deletions, []);
});

test("handleVoiceStateUpdate_unreleasedChannelEmptied_kept", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);

  await handleVoiceStateUpdate(client, leftFrom(world.voices.get(channelId), channelId));

  assert.deepEqual(world.deletions, []);
});

test("handleVoiceStateUpdate_untrackedChannelEmptied_neverDeleted", async () => {
  const voice = addVoice("400000000000000003", 0, CATEGORY);

  await handleVoiceStateUpdate(client, leftFrom(voice, voice.id));

  assert.ok(world.voices.has(voice.id));
});

test("handleVoiceStateUpdate_deleteFails_loggedWithoutThrowing", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  const voice = world.voices.get(channelId)!;
  voice.members.size = 1;
  await releaseVoiceChannel(client, channelId, T0);
  world.deleteError = new Error("socket hang up");

  voice.members.size = 0;
  await handleVoiceStateUpdate(client, leftFrom(voice, channelId));

  assert.equal((await tracked()).length, 1);
  assert.match(world.logs.at(-1) ?? "", /reportée au balayage/);
});

test("handleVoiceChannelDeleted_trackedChannel_untracked", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);

  await handleVoiceChannelDeleted(client, { id: channelId, type: ChannelType.GuildVoice, parentId: CATEGORY });

  assert.deepEqual(await tracked(), []);
});

test("handleVoiceChannelDeleted_channelOutsideCategory_rowKeptForSweep", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);

  await handleVoiceChannelDeleted(client, { id: channelId, type: ChannelType.GuildVoice, parentId: "123456789012345678" });

  assert.equal((await tracked()).length, 1);
});

test("handleVoiceChannelDeleted_textChannel_ignored", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);

  await handleVoiceChannelDeleted(client, { id: channelId, type: ChannelType.GuildText, parentId: CATEGORY });

  assert.equal((await tracked()).length, 1);
});

// --- Balayage --------------------------------------------------------------

test("shouldSweep_releasedEmpty_true", () => {
  assert.equal(shouldSweep({ created_at: T0, released_at: T0 }, 0, T0), true);
});

test("shouldSweep_releasedOccupiedAt24h_false", () => {
  assert.equal(shouldSweep({ created_at: T0, released_at: T0 }, 3, T0 + RELEASED_MAX_AGE_MS), false);
});

test("shouldSweep_releasedOccupiedPast24h_true", () => {
  assert.equal(shouldSweep({ created_at: T0, released_at: T0 }, 3, T0 + RELEASED_MAX_AGE_MS + 1), true);
});

test("shouldSweep_unreleasedAt48h_false", () => {
  assert.equal(shouldSweep({ created_at: T0, released_at: null }, 0, T0 + UNRELEASED_MAX_AGE_MS), false);
});

test("shouldSweep_unreleasedOccupiedPast48h_false", () => {
  assert.equal(shouldSweep({ created_at: T0, released_at: null }, 5, T0 + UNRELEASED_MAX_AGE_MS + 1), false);
});

test("shouldSweep_unreleasedEmptyPast48h_true", () => {
  assert.equal(shouldSweep({ created_at: T0, released_at: null }, 0, T0 + UNRELEASED_MAX_AGE_MS + 1), true);
});

test("sweepVoiceChannels_unreleasedOccupiedPast48h_kept", async () => {
  addVoice("500000000000000013", 4, CATEGORY);
  await track("500000000000000013", "k13", T0, null);

  const report = await sweepVoiceChannels(client, T0 + 72 * HOUR);

  assert.deepEqual(report, { deleted: 0, untracked: 0, kept: 1, failed: 0 });
  assert.deepEqual(world.deletions, []);
});

test("sweepVoiceChannels_releasedEmptyChannelMovedOut_untrackedNotDeleted", async () => {
  addVoice("500000000000000014", 0, OTHER_CATEGORY);
  await track("500000000000000014", "k14", T0, T0);

  const report = await sweepVoiceChannels(client, T0 + HOUR);

  assert.deepEqual(report, { deleted: 0, untracked: 1, kept: 0, failed: 0 });
  assert.ok(world.voices.has("500000000000000014"));
});

test("sweepVoiceChannels_mixedChannels_eachRuleAppliedAndSummaryLogged", async () => {
  const now = T0 + 72 * HOUR;
  addVoice("500000000000000001", 0, CATEGORY); // libéré, vide
  addVoice("500000000000000002", 4, CATEGORY); // libéré depuis 25 h, occupé
  addVoice("500000000000000003", 4, CATEGORY); // libéré depuis 1 h, occupé
  addVoice("500000000000000004", 0, CATEGORY); // jamais libéré, 72 h, vide
  addVoice("500000000000000005", 0, CATEGORY); // jamais libéré, 1 h
  await track("500000000000000001", "k1", now - 2 * HOUR, now - HOUR);
  await track("500000000000000002", "k2", now - 26 * HOUR, now - 25 * HOUR);
  await track("500000000000000003", "k3", now - 2 * HOUR, now - HOUR);
  await track("500000000000000004", "k4", T0, null);
  await track("500000000000000005", "k5", now - HOUR, null);
  await track("500000000000000006", "k6", now - HOUR, null); // supprimé à la main

  const report = await sweepVoiceChannels(client, now);

  assert.deepEqual(report, { deleted: 3, untracked: 1, kept: 2, failed: 0 });
  assert.deepEqual([...world.deletions].sort(), ["500000000000000001", "500000000000000002", "500000000000000004"]);
  assert.deepEqual((await tracked()).map((row) => row.channel_id), ["500000000000000003", "500000000000000005"]);
  assert.equal(world.logs.length, 1);
  assert.match(world.logs[0], /3 supprimé\(s\), 1 disparu\(s\), 0 en échec, 2 conservé\(s\)/);
});

test("sweepVoiceChannels_keptReleasedChannel_deletedOnLaterDeparture", async () => {
  const voice = addVoice("500000000000000007", 2, CATEGORY);
  await track(voice.id, "k7", T0, T0);
  await sweepVoiceChannels(client, T0 + HOUR);

  voice.members.size = 0;
  await handleVoiceStateUpdate(client, leftFrom(voice, voice.id));

  assert.deepEqual(world.deletions, [voice.id]);
});

test("sweepVoiceChannels_reclaimedNearThe48hCap_newDelayStarts", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  world.voices.get(channelId)!.members.size = 3;
  await releaseVoiceChannel(client, channelId, T0 + 47 * HOUR);
  await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0 + 47.5 * HOUR);

  const report = await sweepVoiceChannels(client, T0 + 49 * HOUR);

  assert.deepEqual(report, { deleted: 0, untracked: 0, kept: 1, failed: 0 });
});

test("sweepVoiceChannels_channelReclaimedAfterRelease_notDeletedOnDeparture", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  const voice = world.voices.get(channelId)!;
  voice.members.size = 3;
  await releaseVoiceChannel(client, channelId, T0);
  await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0 + HOUR);
  await sweepVoiceChannels(client, T0 + 2 * HOUR);

  voice.members.size = 0;
  await handleVoiceStateUpdate(client, leftFrom(voice, channelId));

  assert.deepEqual(world.deletions, []);
});

test("sweepVoiceChannels_channelInvisiblePast96h_untracked", async () => {
  addVoice("500000000000000011", 0, CATEGORY);
  await track("500000000000000011", "k11", T0, null);
  world.fetchVoiceError = discordError(50001, "Missing Access");

  const report = await sweepVoiceChannels(client, T0 + 97 * HOUR);

  assert.deepEqual(report, { deleted: 0, untracked: 1, kept: 0, failed: 0 });
  assert.deepEqual(await tracked(), []);
});

test("sweepVoiceChannels_channelInvisibleUnder96h_failedAndKept", async () => {
  addVoice("500000000000000012", 0, CATEGORY);
  await track("500000000000000012", "k12", T0, null);
  world.fetchVoiceError = discordError(50001, "Missing Access");

  const report = await sweepVoiceChannels(client, T0 + 95 * HOUR);

  assert.deepEqual(report, { deleted: 0, untracked: 0, kept: 0, failed: 1 });
  assert.equal((await tracked()).length, 1);
});

test("sweepVoiceChannels_discordFails_countedFailedAndKept", async () => {
  addVoice("500000000000000008", 0, CATEGORY);
  await track("500000000000000008", "k8", T0, T0);
  world.fetchVoiceError = new Error("socket hang up");

  const report = await sweepVoiceChannels(client, T0 + HOUR);

  assert.deepEqual(report, { deleted: 0, untracked: 0, kept: 0, failed: 1 });
  assert.equal((await tracked()).length, 1);
});

test("sweepVoiceChannels_nothingToDo_noLog", async () => {
  addVoice("500000000000000009", 0, CATEGORY);
  await track("500000000000000009", "k9", T0, null);

  const report = await sweepVoiceChannels(client, T0 + HOUR);

  assert.deepEqual(report, { deleted: 0, untracked: 0, kept: 1, failed: 0 });
  assert.deepEqual(world.logs, []);
});

test("sweepVoiceChannels_untrackedChannelInCategory_neverTouched", async () => {
  addVoice("500000000000000010", 0, CATEGORY);

  await sweepVoiceChannels(client, T0 + 100 * HOUR);

  assert.ok(world.voices.has("500000000000000010"));
});

// --- Salon suivi déplacé hors de la catégorie -----------------------------

test("ensureTeamVoiceChannel_trackedChannelMovedOut_newChannelCreatedInCategory", async () => {
  const first = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  world.voices.get(first.channelId)!.parentId = OTHER_CATEGORY;

  const second = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0 + HOUR);

  assert.equal(second.created, true);
  assert.notEqual(second.channelId, first.channelId);
  assert.equal(world.voices.get(second.channelId)?.parentId, CATEGORY);
  assert.ok(world.voices.has(first.channelId));
  assert.deepEqual((await tracked()).map((row) => row.channel_id), [second.channelId]);
});

test("releaseVoiceChannel_channelMovedOutOfCategory_untrackedNotDeleted", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  world.voices.get(channelId)!.parentId = OTHER_CATEGORY;

  const result = await releaseVoiceChannel(client, channelId, T0 + HOUR);

  assert.deepEqual(result, { deleted: true });
  assert.deepEqual(world.deletions, []);
  assert.ok(world.voices.has(channelId));
  assert.deepEqual(await tracked(), []);
});

test("handleVoiceStateUpdate_releasedChannelMovedThenEmptied_untrackedNotDeleted", async () => {
  const { channelId } = await ensureTeamVoiceChannel(client, KEY, "Les Genji", T0);
  const voice = world.voices.get(channelId)!;
  voice.members.size = 2;
  await releaseVoiceChannel(client, channelId, T0);
  voice.parentId = OTHER_CATEGORY;

  voice.members.size = 0;
  await handleVoiceStateUpdate(client, leftFrom(voice, channelId));

  assert.deepEqual(world.deletions, []);
  assert.deepEqual(await tracked(), []);
});

// Le site recopie ces durées (`VOICE_BOT_*` de `lib/shared/match-voice.ts`) dans
// /rgpd et le registre (T18) : les changer ici impose de changer le site et ses
// textes légaux dans le même temps (ERREUR.txt, EF-43).
const HOUR_MS = 60 * 60 * 1000;

test("voiceDurations_releasedMaxAge_matchesSiteDeclared24Hours", () => {
  assert.equal(RELEASED_MAX_AGE_MS, 24 * HOUR_MS);
});

test("voiceDurations_unreleasedMaxAge_matchesSiteDeclared48Hours", () => {
  assert.equal(UNRELEASED_MAX_AGE_MS, 48 * HOUR_MS);
});

test("voiceDurations_abandonedMaxAge_matchesSiteDeclared96Hours", () => {
  assert.equal(ABANDONED_MAX_AGE_MS, 96 * HOUR_MS);
});

test("voiceDurations_sweepCron_matchesSiteDeclared30Minutes", () => {
  assert.equal(VOICE_SWEEP_CRON, "*/30 * * * *");
});
