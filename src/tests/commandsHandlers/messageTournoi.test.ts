import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChatInputCommandInteraction, Client, MessageComponentInteraction } from "discord.js";
import { runMessageTournoi, type MessageTournoiDeps } from "../../commandsHandlers/messageTournoi.js";
import type { SiteResult, StaffMessageCall, StaffMessagePreview, StaffMessageSent } from "../../tournament/siteStaffMessage.js";

// /message-tournoi : aperçu éphémère, panneau réservé à l'auteur, expiration, site injoignable sans plantage.

type Edit = { content: string; components?: unknown[] };

const preview: StaffMessagePreview = { tournament: { id: 12, name: "Coupe" }, recipients: { total: 3, reachable: 2, withoutDiscord: 1, optedOut: 0 } };
const sent: StaffMessageSent = { ...preview, delivery: { sent: 2, failed: 0, skipped: 1, pushed: 3, botUnreachable: false } };

class FakeCollector extends EventEmitter {
  stopped: string | null = null;
  stop(reason = "user"): void {
    if (this.stopped !== null) { return; }
    this.stopped = reason;
    this.emit("end", new Map(), reason);
  }
}

function setup(options: { tournoi?: string; preview?: SiteResult<StaffMessagePreview>[]; send?: SiteResult<StaffMessageSent>; config?: boolean } = {}) {
  const replies: string[] = [];
  const edits: Edit[] = [];
  const previews: StaffMessageCall[] = [];
  const sends: StaffMessageCall[] = [];
  const collector = new FakeCollector();
  let collectorTime: number | undefined;
  const queue = [...(options.preview ?? [{ ok: true as const, data: preview }])];
  const interaction = {
    id: "i1",
    locale: "fr",
    user: { id: "100000000000000009" },
    deferred: false,
    replied: false,
    client: {},
    options: { getString: (name: string) => (name === "tournoi" ? options.tournoi ?? "https://bluegenji-esport.fr/tournois/12" : "Salut") },
    reply: async (p: { content: string }) => { replies.push(p.content); },
    deferReply: async function (this: { deferred: boolean }) { this.deferred = true; },
    editReply: async (p: Edit) => {
      edits.push(p);
      return { createMessageComponentCollector: (o: { time: number }) => { collectorTime = o.time; return collector; } };
    },
  } as unknown as ChatInputCommandInteraction;
  const deps: MessageTournoiDeps = {
    config: () => (options.config === false ? null : { baseUrl: "http://127.0.0.1:3000", token: "tok" }),
    preview: async (_c, call) => { previews.push(call); return queue.shift() ?? { ok: true, data: preview }; },
    send: async (_c, call) => { sends.push(call); return options.send ?? { ok: true, data: sent }; },
    now: () => 1_764_000_000_000,
    lifetimeMs: 300_000,
  };
  return { interaction, deps, replies, edits, previews, sends, collector, collectorTime: () => collectorTime };
}

function component(customId: string, extra: { userId?: string; values?: string[] } = {}) {
  const updates: Edit[] = [];
  const replies: string[] = [];
  const value = {
    customId,
    user: { id: extra.userId ?? "100000000000000009" },
    values: extra.values ?? [],
    isStringSelectMenu: () => extra.values !== undefined,
    update: async (p: Edit) => { updates.push(p); },
    reply: async (p: { content: string }) => { replies.push(p.content); },
    deferUpdate: async () => undefined,
  } as unknown as MessageComponentInteraction;
  return { value, updates, replies };
}

const client = { channels: { fetch: async () => ({ send: async () => ({ id: "log" }) }) } } as unknown as Client;
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("messageTournoi_unrecognisedTournament_repliesEphemeralWithoutCallingTheSite", async () => {
  const t = setup({ tournoi: "coupe-d-hiver" });

  await runMessageTournoi(client, t.interaction, t.deps);

  assert.deepEqual(t.replies, ["Tournoi non reconnu : donne son numéro ou le lien de sa fiche sur le site."]);
  assert.equal(t.previews.length, 0);
});

test("messageTournoi_siteNotConfigured_repliesEphemeral", async () => {
  const t = setup({ config: false });

  await runMessageTournoi(client, t.interaction, t.deps);

  assert.match(t.replies[0], /n'est pas configurée/);
});

test("messageTournoi_previewRefused_showsTheRefusal", async () => {
  const t = setup({ preview: [{ ok: false, code: "FORBIDDEN" }] });

  await runMessageTournoi(client, t.interaction, t.deps);

  assert.deepEqual(t.edits.map((e) => e.content), ["❌ Commande réservée au staff des tournois du site BlueGenji."]);
});

test("messageTournoi_siteUnreachable_showsMessageWithoutThrowing", async () => {
  const t = setup({ preview: [{ ok: false, code: "SITE_UNREACHABLE" }] });

  await runMessageTournoi(client, t.interaction, t.deps);

  assert.match(t.edits[0].content, /injoignable/);
});

test("messageTournoi_previewOk_showsPanelForEveryoneWithFiveMinuteCollector", async () => {
  const t = setup();

  await runMessageTournoi(client, t.interaction, t.deps);

  assert.deepEqual(t.previews[0], { discordId: "100000000000000009", tournamentId: 12, categories: ["ALL"], message: "Salut" });
  assert.equal(t.edits[0].components?.length, 2);
  assert.equal(t.collectorTime(), 300_000);
});

test("messageTournoi_otherUserClicks_isRefusedAndNothingIsSent", async () => {
  const t = setup();
  await runMessageTournoi(client, t.interaction, t.deps);
  const click = component("staffmsg:send:i1", { userId: "200000000000000001" });

  t.collector.emit("collect", click.value);
  await flush();

  assert.deepEqual(click.replies, ["Seul l'auteur de la commande peut utiliser ce panneau."]);
  assert.equal(t.sends.length, 0);
});

test("messageTournoi_cancel_closesPanelWithoutSending", async () => {
  const t = setup();
  await runMessageTournoi(client, t.interaction, t.deps);
  const click = component("staffmsg:cancel:i1");

  t.collector.emit("collect", click.value);
  await flush();

  assert.deepEqual(click.updates, [{ content: "Envoi annulé : rien n'est parti.", components: [] }]);
  assert.equal(t.sends.length, 0);
  assert.equal(t.collector.stopped, "cancel");
});

test("messageTournoi_selectThenSend_sendsSelectedCategoriesAndShowsCounts", async () => {
  const t = setup();
  await runMessageTournoi(client, t.interaction, t.deps);

  t.collector.emit("collect", component("staffmsg:select:i1", { values: ["OWNERS", "PLAYERS"] }).value);
  await flush();
  const send = component("staffmsg:send:i1");
  t.collector.emit("collect", send.value);
  await flush();

  assert.deepEqual(t.previews[1].categories, ["PLAYERS", "OWNERS"]);
  assert.deepEqual(t.sends[0].categories, ["PLAYERS", "OWNERS"]);
  assert.deepEqual(send.updates, [{ content: "⏳ Envoi en cours… Le bilan s'affichera ici.", components: [] }]);
  assert.match(t.edits.at(-1)?.content ?? "", /^✅ Message envoyé aux participants de Coupe : 2 message\(s\) privé\(s\) remis/);
});

test("messageTournoi_sendTimesOut_saysItMayStillBeSending", async () => {
  const t = setup({ send: { ok: false, code: "SITE_TIMEOUT" } });
  await runMessageTournoi(client, t.interaction, t.deps);

  t.collector.emit("collect", component("staffmsg:send:i1").value);
  await flush();

  assert.match(t.edits.at(-1)?.content ?? "", /peut être encore en cours/);
});

test("messageTournoi_expiry_closesPanel", async () => {
  const t = setup();
  await runMessageTournoi(client, t.interaction, t.deps);

  t.collector.stop("time");
  await flush();

  assert.deepEqual(t.edits.at(-1), { content: "Aperçu expiré : rien n'est parti. Relance la commande pour écrire aux participants.", components: [] });
});

test("messageTournoi_clickAfterSend_isIgnored", async () => {
  const t = setup();
  await runMessageTournoi(client, t.interaction, t.deps);
  t.collector.emit("collect", component("staffmsg:send:i1").value);
  await flush();

  t.collector.emit("collect", component("staffmsg:send:i1").value);
  await flush();

  assert.equal(t.sends.length, 1);
});
