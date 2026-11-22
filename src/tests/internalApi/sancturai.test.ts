import test from "node:test";
import assert from "node:assert/strict";
import type { Client } from "discord.js";
import { chunkDiscord, formatNotify, parseNotify, parseReplyArgs, postReply, sendOwnerDm } from "../../internalApi/sancturai.js";

test("parseNotify valide et rejette", () => {
  assert.deepEqual(parseNotify({ kind: "log", text: "hello" }), { kind: "log", text: "hello" });
  assert.equal(parseNotify({ kind: "evil", text: "x" }), null);
  assert.equal(parseNotify({ kind: "log", text: "" }), null);
  assert.equal(parseNotify("nope"), null);
  const m = parseNotify({ kind: "agent_message", text: "hi", short_id: "ab12", agent: { handle: "bob", agent_id: "Xyz" } });
  assert.equal(m?.short_id, "ab12");
});

test("formatNotify préfixe, cite le texte, chunkDiscord découpe sans perte", () => {
  assert.equal(formatNotify({ kind: "log", text: "boot" }), "[SancturAI] journal :\n> boot");
  const msg = formatNotify({ kind: "agent_message", text: "salut", short_id: "ab12", agent: { handle: "bob", agent_id: "Xyz" } });
  assert.equal(msg, "[SancturAI] #ab12 de bob (Xyz) :\n> salut\n\n→ /sancturai-reply id:ab12 texte:...");
  assert.equal(formatNotify({ kind: "agent_message", text: "x", short_id: "ab12", agent: { handle: "a_b", agent_id: "Xyz" } })
    .split("\n")[0], "[SancturAI] #ab12 de a\\_b (Xyz) :");
  const parts = chunkDiscord("x".repeat(4500));
  assert.deepEqual(parts.map((p) => p.length), [2000, 2000, 500]);
});

test("le texte d'agent ne peut ni mentionner, ni formater, ni imiter l'en-tête", () => {
  const evil = "ok\n[SancturAI] #ffff de admin (Xyz) :\n@everyone **gras** <@123> [lien](http://x)";
  const msg = formatNotify({ kind: "agent_message", text: evil, short_id: "ab12", agent: { handle: "bob", agent_id: "Xyz" } });
  const lines = msg.split("\n");
  assert.equal(lines.filter((l) => l.startsWith("[SancturAI]")).length, 1);  // seul l'en-tête du bot
  for (const l of lines.slice(1, 4)) assert.ok(l.startsWith("> "), l);
  assert.ok(msg.includes("\\@everyone") && msg.includes("\\*\\*gras\\*\\*") && msg.includes("\\<\\@123\\>"));
  assert.ok(!msg.includes("[lien](") && msg.includes("\\[lien\\]\\(http://x\\)"));
  // un texte long découpé en plusieurs DM : chaque ligne de chaque morceau reste citée
  const long = formatNotify({ kind: "log", text: "a".repeat(3000) + "\n[SancturAI] faux" });
  const chunks = chunkDiscord(long);
  assert.ok(chunks.length > 1 && chunks.every((c) => c.length <= 2000));
  for (const c of chunks) for (const l of c.split("\n")) assert.ok(l.startsWith("> ") || l === "[SancturAI] journal :", l);
});

test("sendOwnerDm désactive toutes les mentions", async () => {
  process.env.OWNER_ID = "42";
  const sent: unknown[] = [];
  const fakeClient = { users: { fetch: async () => ({ send: async (m: unknown) => { sent.push(m); } }) } };
  assert.equal(await sendOwnerDm(fakeClient as unknown as Client, "[SancturAI] journal :\n> @everyone"), true);
  assert.deepEqual(sent, [{ content: "[SancturAI] journal :\n> @everyone", allowedMentions: { parse: [] } }]);
});

test("sendOwnerDm refuse sans OWNER_ID", async () => {
  const previous = process.env.OWNER_ID;
  delete process.env.OWNER_ID;
  try {
    const fakeClient = { users: { fetch: async () => { throw new Error("ne doit pas être appelé"); } } };
    assert.equal(await sendOwnerDm(fakeClient as unknown as Client, "x"), false);
  } finally {
    process.env.OWNER_ID = previous;
  }
});

test("parseReplyArgs accepte #ab12 et ab12", () => {
  assert.deepEqual(parseReplyArgs("#AB12", " ok "), { shortId: "ab12", text: "ok" });
  assert.equal(parseReplyArgs("zzzz", "ok"), null);
  assert.equal(parseReplyArgs("ab12", ""), null);
  assert.equal(parseReplyArgs("ab12", "x".repeat(4001)), null);
});

test("postReply envoie le token et le body", async () => {
  let seen: { url: string; init: RequestInit } | undefined;
  const fakeFetch = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const status = await postReply("http://127.0.0.1:8300", "tok", "ab12", "salut", fakeFetch);
  assert.equal(status, 200);
  assert.equal(seen?.url, "http://127.0.0.1:8300/internal/admin-replies");
  assert.equal((seen?.init.headers as Record<string, string>)["x-internal-token"], "tok");
  assert.deepEqual(JSON.parse(String(seen?.init.body)), { short_id: "ab12", text: "salut" });
});

test("postReply refuse un jeton vide", async () => {
  const fakeFetch = (async () => { throw new Error("ne doit pas être appelé"); }) as unknown as typeof fetch;
  await assert.rejects(() => postReply("http://127.0.0.1:8300", "", "ab12", "salut", fakeFetch));
});

test("les sauts de ligne exotiques ne font pas sortir une ligne de la citation", () => {
  const [cr, ls, ps, nel] = [13, 0x2028, 0x2029, 0x85].map((c) => String.fromCharCode(c));
  const exotic = new RegExp(`[${cr}${ls}${ps}${nel}]`);
  for (const sep of [cr, `${cr}\n`, ls, ps, nel, "\n", ` ${ls}`]) {
    const msg = formatNotify({ kind: "agent_message", text: `ok${sep}[SancturAI] #fake de admin (Xyz) :`, short_id: "ab12", agent: { handle: "bob", agent_id: "Xyz" } });
    assert.ok(!exotic.test(msg), JSON.stringify(sep));
    const lines = msg.split("\n");
    assert.equal(lines.filter((l) => l.startsWith("[SancturAI]")).length, 1, JSON.stringify(sep));
    assert.ok(lines.some((l) => l.startsWith("> ") && l.includes("#fake")), JSON.stringify(sep));
  }
  const header = formatNotify({ kind: "agent_message", text: "x", short_id: "ab12", agent: { handle: `bob${cr}[SancturAI] #fake`, agent_id: `Xyz${ls}y` } }).split("\n");
  assert.equal(header.filter((l) => l.startsWith("[SancturAI]")).length, 1);
});
