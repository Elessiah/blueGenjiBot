import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Gardes de source, comme `internalApi/errorResponses.test.ts` : les routes et
 * la commande de restauration vivent derrière un port ouvert ou un client
 * Discord, qu'il faudrait monter en entier pour observer un ordre d'appels.
 */
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src");
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), "utf8");

test("la route d'écriture d'un module refuse un serveur que le bot n'a pas rejoint, avant d'écrire", () => {
  const source = read("internalApi.ts");
  const route = source.slice(source.indexOf('app.put("/internal/servers/:id/modules/:moduleKey"'));
  const guard = route.indexOf("refuseUnjoinedGuild(client, res, guildId)");
  const write = route.indexOf("setModuleEnabled(");
  assert.ok(guard > 0, "garde GUILD_NOT_JOINED absente");
  assert.ok(source.includes('res.status(404).json({ error: "GUILD_NOT_JOINED" })'));
  assert.ok(guard < write, "la garde doit précéder l'écriture");
  const getRoute = source.slice(source.indexOf('app.get("/internal/servers/:id/modules"'));
  assert.ok(getRoute.indexOf("refuseUnjoinedGuild(client, res, guildId)") < getRoute.indexOf("listModules("));
});

test("une restauration réussie rejoue la purge du flux et les durées de conservation", () => {
  const source = read("commandsHandlers", "admin", "restoreBackup.ts");
  const reply = source.indexOf("await safeReply(interaction, `${result.success");
  // La purge du flux avant la réponse : la base restaurée est déjà servie par l'API interne.
  const purge = source.indexOf("await purgeFeedIdentifiers(client)");
  assert.ok(purge > 0 && purge < reply);
  // Le reste après, sans être attendu : il fait des appels réseau.
  const retention = source.indexOf("void runDataRetention(client)");
  assert.ok(retention > reply);
});

test("le démarrage et la tâche de nuit lancent les durées de conservation", () => {
  const source = read("main.ts");
  const ready = source.slice(source.indexOf('client.on("clientReady"'), source.indexOf('client.on("guildCreate"'));
  assert.ok(ready.includes("void runDataRetention(client)"), "démarrage");
  const start = ready.indexOf('"5 0 * * *"');
  const nightly = ready.slice(start, ready.indexOf("cron.schedule(", start));
  // Un appel, pas une mention : la ligne commence par `await`.
  assert.match(nightly, /^\s*await runDataRetention\(client\);/m, "tâche de 00:05");
});

test("guildDelete passe par eraseGuild, le chemin du rattrapage", () => {
  const source = read("main.ts");
  const handler = source.slice(source.indexOf('client.on("guildDelete"'), source.indexOf('client.on("channelDelete"'));
  assert.ok(handler.includes("eraseGuild(guild.id)"));
  assert.ok(!handler.includes("_resetServer"));
});
