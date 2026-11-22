import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Routes, type Client, type REST } from "discord.js";
import { updateGlobalCommands } from "../../utils/updateGlobalCommands.js";
import { globalCommands } from "../../config/commands.js";

type Put = { route: string; body: { name: string }[] };

function fakeRest(puts: Put[], error?: unknown): REST {
  return {
    put: async (route: string, opts: { body: { name: string }[] }) => {
      if (error) throw error;
      puts.push({ route, body: opts.body });
      return [];
    },
  } as unknown as REST;
}

function fakeClient(logs: string[]): Client {
  return {
    channels: { fetch: async () => ({ send: async (p: { content: string }) => { logs.push(p.content); return { id: "log" }; } }) },
    users: { fetch: async () => ({ send: async () => ({}) }) },
  } as unknown as Client;
}

test("updateGlobalCommands remplace l'ensemble global par toutes les commandes globales", async () => {
  const saved = process.env.CLIENT_ID;
  process.env.CLIENT_ID = "app123";
  try {
    const puts: Put[] = [];
    await updateGlobalCommands(fakeClient([]), fakeRest(puts));
    assert.equal(puts.length, 1);
    assert.equal(puts[0].route, Routes.applicationCommands("app123"));
    assert.deepEqual(puts[0].body.map((c) => c.name).sort(), Object.keys(globalCommands).sort());
    assert.ok(puts[0].body.some((c) => c.name === "sancturai-reply"));
  } finally {
    if (saved === undefined) delete process.env.CLIENT_ID; else process.env.CLIENT_ID = saved;
  }
});

test("updateGlobalCommands ne lève jamais : faute réelle au journal", async () => {
  const logs: string[] = [];
  await updateGlobalCommands(fakeClient(logs), fakeRest([], new Error("Missing Access")));
  assert.ok(logs.some((l) => l.includes("Missing Access")));
});

test("updateGlobalCommands ne lève jamais : panne réseau passagère sur la console seule", async () => {
  const logs: string[] = [];
  const saved = console.warn;
  const warned: string[] = [];
  console.warn = (msg: string) => { warned.push(msg); };
  try {
    await updateGlobalCommands(fakeClient(logs), fakeRest([], Object.assign(new Error("reset"), { code: "ECONNRESET" })));
  } finally {
    console.warn = saved;
  }
  assert.equal(logs.length, 0);
  assert.equal(warned.length, 1);
});

test("le démarrage enregistre les commandes globales et le routage les retrouve", () => {
  const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src");
  const source = fs.readFileSync(path.join(SRC, "main.ts"), "utf8");
  const ready = source.slice(source.indexOf('client.on("clientReady"'), source.indexOf('client.on("guildCreate"'));
  assert.ok(ready.includes("await updateGlobalCommands(client)"));
  const routing = source.slice(source.indexOf('client.on("interactionCreate"'), source.indexOf('client.on("messageCreate"'));
  assert.ok(routing.includes("globalCommands[commandName]"));
});
