import test from "node:test";
import assert from "node:assert/strict";
import type { ChatInputCommandInteraction, Client } from "discord.js";
import { sancturaiReply } from "../../commandsHandlers/sancturaiReply.js";

type Call = { kind: "defer" | "reply" | "edit"; content?: string };

function fakeInteraction(userId: string, id: string, texte: string, calls: Call[]): ChatInputCommandInteraction {
  const options = { getString: (name: string) => (name === "id" ? id : texte) };
  return {
    user: { id: userId },
    options,
    deferred: false,
    client: {},
    deferReply: async function (this: { deferred: boolean }) { this.deferred = true; calls.push({ kind: "defer" }); },
    reply: async (p: { content: string }) => { calls.push({ kind: "reply", content: p.content }); },
    editReply: async (p: { content: string }) => { calls.push({ kind: "edit", content: p.content }); },
  } as unknown as ChatInputCommandInteraction;
}

const client = { channels: { fetch: async () => ({ send: async () => ({ id: "log" }) }) }, users: { fetch: async () => ({ send: async () => ({}) }) } } as unknown as Client;

async function withEnv(fn: () => Promise<void>): Promise<void> {
  const saved = { o: process.env.OWNER_ID, u: process.env.SANCTURAI_INTERNAL_URL, t: process.env.SANCTURAI_INTERNAL_TOKEN, f: globalThis.fetch };
  process.env.OWNER_ID = "42";
  process.env.SANCTURAI_INTERNAL_URL = "http://127.0.0.1:8300";
  process.env.SANCTURAI_INTERNAL_TOKEN = "tok";
  try { await fn(); } finally {
    for (const [k, v] of [["OWNER_ID", saved.o], ["SANCTURAI_INTERNAL_URL", saved.u], ["SANCTURAI_INTERNAL_TOKEN", saved.t]] as const) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    globalThis.fetch = saved.f;
  }
}

test("/sancturai-reply refuse un autre que le propriétaire, sans appel réseau", async () => {
  await withEnv(async () => {
    globalThis.fetch = (async () => { throw new Error("ne doit pas être appelé"); }) as unknown as typeof fetch;
    const calls: Call[] = [];
    await sancturaiReply(client, fakeInteraction("7", "ab12", "ok", calls));
    assert.deepEqual(calls.map((c) => c.kind), ["reply"]);
  });
});

test("/sancturai-reply accuse réception avant l'appel puis confirme", async () => {
  await withEnv(async () => {
    let sent: unknown;
    globalThis.fetch = (async (_u: string, init: RequestInit) => { sent = JSON.parse(String(init.body)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const calls: Call[] = [];
    await sancturaiReply(client, fakeInteraction("42", "#AB12", "salut", calls));
    assert.deepEqual(sent, { short_id: "ab12", text: "salut" });
    assert.deepEqual(calls.map((c) => c.kind), ["defer", "edit"]);
    assert.match(calls[1].content ?? "", /#ab12/);
  });
});

test("/sancturai-reply répond même quand SancturAI est injoignable ou refuse", async () => {
  await withEnv(async () => {
    const calls: Call[] = [];
    globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await sancturaiReply(client, fakeInteraction("42", "ab12", "x", calls));
    assert.deepEqual(calls.map((c) => c.kind), ["defer", "edit"]);
    calls.length = 0;
    globalThis.fetch = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    await sancturaiReply(client, fakeInteraction("42", "ab12", "x", calls));
    assert.match(calls[1].content ?? "", /404/);
    calls.length = 0;
    await sancturaiReply(client, fakeInteraction("42", "zzzz", "x", calls));
    assert.match(calls[1].content ?? "", /invalides/);
  });
});
