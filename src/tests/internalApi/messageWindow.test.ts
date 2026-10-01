import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Garde de source, comme `errorResponses.test.ts` : les routes vivent dans
 * `startInternalApi(client)`, qui ouvre un port et un client Discord.
 *
 * Ce qu'on tient : les compteurs tires de `OGMsg` / `DPMsg` ne regardent pas
 * plus loin que la purge de ces tables (`MESSAGE_RETENTION_DAYS`). Ils
 * annoncaient 30 jours, et la tendance des KPI se comparait a la periode
 * 30-60 jours, toujours vide.
 */
const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "src", "internalApi.ts"),
  "utf8",
);

/** Corps d'une route, de sa declaration a la suivante. */
function route(signature: string): string {
  const start = SOURCE.indexOf(signature);
  assert.ok(start >= 0, `route introuvable : ${signature}`);
  const next = SOURCE.indexOf("app.", start + signature.length);
  return SOURCE.slice(start, next < 0 ? undefined : next);
}

const ROUTES = ['app.get("/internal/stats"', 'app.get("/internal/kpis"', 'app.get("/internal/servers"'];

test("la fenetre des compteurs de messages est celle de la conservation", () => {
  assert.match(SOURCE, /const MESSAGE_WINDOW_DAYS = MESSAGE_RETENTION_DAYS;/);
});

for (const signature of ROUTES) {
  test(`${signature} ne lit OGMsg/DPMsg que sur la fenetre de conservation`, () => {
    const body = route(signature);
    assert.doesNotMatch(body, /-(30|60) day/, "fenetre en dur plus large que la purge");
    assert.match(body, /MESSAGE_WINDOW_SQL/);
    assert.match(body, /windowDays: MESSAGE_WINDOW_DAYS/, "fenetre absente de la reponse");
  });
}

test("/internal/stats nomme ses compteurs d'apres la fenetre reelle", () => {
  const body = route('app.get("/internal/stats"');
  assert.doesNotMatch(body, /Last30Days/);
  for (const field of ["messagesLast7Days", "relayedMessagesLast7Days", "uniqueUsersLast7Days"]) {
    assert.ok(body.includes(`${field}:`), `${field} absent`);
  }
});

test("/internal/kpis ne compare plus les messages a une periode purgee", () => {
  const body = route('app.get("/internal/kpis"');
  assert.match(body, /messages: \{ value: messagesNow, delta: null,/);
  assert.match(body, /relays: \{ value: relaysNow, delta: null,/);
});

test("/internal/servers expose relays7j, plus relays30j", () => {
  const body = route('app.get("/internal/servers"');
  assert.doesNotMatch(body, /relays30j/);
  assert.match(body, /relays7j/);
});

test("/internal/activity ne lit les relais et n'en fait la moyenne que sur les jours conserves", () => {
  const body = route('app.get("/internal/activity"');
  assert.match(body, /req\.query\.range \?\? "7j"/, "plage par defaut plus large que la conservation");
  assert.match(body, /const relayDays = Math\.min\(days, MESSAGE_WINDOW_DAYS\);/);
  assert.match(body, /\[`-\$\{relayDays\} day`\]/, "relais lus au-dela de la purge");
  assert.match(body, /sumRelays \/ relayDays/);
  assert.doesNotMatch(body, /sumRelays \/ days/);
  assert.match(body, /windowDays: MESSAGE_WINDOW_DAYS/);
  // Compatibilite : un site plus ancien demande encore 30j / 90j.
  assert.match(body, /"30j": 30, "90j": 90/);
});
