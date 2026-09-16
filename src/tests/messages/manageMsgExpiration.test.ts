import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

// Base jetable designee **avant** l'import : le singleton l'ouvre a son premier
// appel. Meme montage que `tests/check/checkBan.test.ts`.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-purge-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.BDD_PATH = path.join(TMP_DIR, "bot.sqlite");
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";
import { MESSAGE_RETENTION_DAYS, manageMsgExpiration } from "../../messages/manageMsgExpiration.js";
import type { Client } from "discord.js";

/**
 * La fenetre de conservation des messages de service, sur une **vraie** base.
 *
 * C'est le seul niveau ou ces tests ont un sens : le defaut corrige ici ne
 * tenait ni a une signature ni a un type, mais a une comparaison de chaines
 * entre deux formats de date — `"2026-09-13 19:16:30"` d'un cote,
 * `"2026-09-13T17:16:30.000Z"` de l'autre. En position 10, l'espace precede le
 * `T`, si bien que **toute ligne datee du jour du seuil passait pour
 * anterieure**, quelle que soit son heure. La coupe n'etait donc pas une
 * fenetre glissante mais un minuit UTC, et la conservation reelle oscillait
 * entre deux et trois jours selon l'heure a laquelle un relais declenchait le
 * menage.
 *
 * D'ou la forme de ces tests : les ages sont poses **en heures**, de part et
 * d'autre de la frontiere, et exprimes relativement a l'horloge de la base.
 * Un test qui ne regarderait que « huit jours » contre « un jour » passerait
 * aussi bien sur le code d'avant.
 */

const HOURS_PER_DAY = 24;
const RETENTION_HOURS = MESSAGE_RETENTION_DAYS * HOURS_PER_DAY;

/** Le client n'est pas utilise : le menage est purement en base. */
const client = {} as unknown as Client;

/** Pose un message d'origine d'un age donne, avec sa copie et son service. */
async function seedMessage(id: string, ageHours: number): Promise<void> {
  const bdd = await getBddInstance();
  const age = "-" + ageHours + " hours";
  await bdd.raw(
    "INSERT INTO OGMsg (id_msg, id_author, date) VALUES (?, 'auteur-1', DATETIME('now', ?))",
    [id, age],
  );
  await bdd.raw(
    "INSERT INTO DPMsg (id_msg, id_channel, id_og, date) VALUES (?, ?, ?, DATETIME('now', ?))",
    ["dp-" + id, "salon-" + id, id, age],
  );
  await bdd.raw("INSERT INTO MessageService (id_msg, id_service) VALUES (?, 1)", [id]);
}

/**
 * Vide les trois tables avant chaque test.
 *
 * La purge est **globale** : sans cette remise a zero, les lignes encore
 * vivantes d'un test precedent se retrouvent dans les assertions du suivant,
 * qui echoue pour une raison qui n'est pas la sienne.
 */
async function resetTables(): Promise<void> {
  const bdd = await getBddInstance();
  for (const table of ["OGMsg", "DPMsg", "MessageService"]) {
    await bdd.raw("DELETE FROM " + table, []);
  }
}

async function idsIn(table: string, column: string): Promise<Set<string>> {
  const bdd = await getBddInstance();
  const rows = await bdd.raw<Record<string, string>>("SELECT " + column + " AS v FROM " + table, []);
  return new Set(rows.map((r) => r.v));
}

test("garde ce qui est en deca de la fenetre, efface ce qui est au-dela", async () => {
  await resetTables();
  // Les deux bornes sont a une heure de la frontiere : c'est la seule distance
  // qui distingue une vraie fenetre glissante d'une coupe au jour calendaire.
  await seedMessage("juste-avant", RETENTION_HOURS - 1);
  await seedMessage("juste-apres", RETENTION_HOURS + 1);

  await manageMsgExpiration(client);

  const restants = await idsIn("OGMsg", "id_msg");
  assert.ok(restants.has("juste-avant"), "un message de moins de 7 jours a ete efface");
  assert.ok(!restants.has("juste-apres"), "un message de plus de 7 jours a survecu");
});

test("la frontiere ne depend pas de l'heure qu'il est", async () => {
  await resetTables();
  // Le defaut d'origine se voyait exactement ici : la coupe tombait a un minuit
  // UTC, donc un message de 6 j 20 h partait avec les vieux des que le menage
  // se declenchait en soiree. On balaye donc toute la veille de l'echeance.
  for (let h = 1; h <= 23; h++) {
    await seedMessage("veille-" + h, RETENTION_HOURS - h);
  }

  await manageMsgExpiration(client);

  const restants = await idsIn("OGMsg", "id_msg");
  for (let h = 1; h <= 23; h++) {
    assert.ok(restants.has("veille-" + h), "efface a " + (RETENTION_HOURS - h) + " h, soit avant l'echeance");
  }
});

test("emporte les copies relayees et le lien de service du message expire", async () => {
  await resetTables();
  await seedMessage("expire", RETENTION_HOURS + 48);
  await seedMessage("vivant", 2);

  await manageMsgExpiration(client);

  assert.deepEqual([...(await idsIn("DPMsg", "id_og"))].sort(), ["vivant"]);
  assert.deepEqual([...(await idsIn("MessageService", "id_msg"))].sort(), ["vivant"]);
});

test("ne touche pas au lien de service d'un message encore vivant", async () => {
  await resetTables();
  // `MessageService` ne porte pas de date : elle ne peut etre datee que par le
  // message qu'elle qualifie. Une purge qui se tromperait de sens la viderait
  // entierement sans qu'aucune autre table ne le montre.
  await seedMessage("recent", 1);
  await seedMessage("hier", HOURS_PER_DAY);

  await manageMsgExpiration(client);

  assert.deepEqual([...(await idsIn("MessageService", "id_msg"))].sort(), ["hier", "recent"]);
});

test("ne laisse rien derriere quand tout a expire", async () => {
  await resetTables();
  await seedMessage("vieux-1", RETENTION_HOURS + 1);
  await seedMessage("vieux-2", RETENTION_HOURS * 3);

  await manageMsgExpiration(client);

  assert.equal((await idsIn("OGMsg", "id_msg")).size, 0);
  assert.equal((await idsIn("DPMsg", "id_og")).size, 0);
  assert.equal((await idsIn("MessageService", "id_msg")).size, 0);
});

test("une base vide ne fait pas echouer le menage", async () => {
  await resetTables();
  await manageMsgExpiration(client);
  assert.equal((await idsIn("OGMsg", "id_msg")).size, 0);
});

test("la fenetre annoncee est bien d'une semaine", async () => {
  assert.equal(MESSAGE_RETENTION_DAYS, 7);
});

test("le seuil se calcule en SQL, jamais en JavaScript", async () => {
  // Les tests de fenetre ci-dessus ne suffisent pas seuls, et c'est une
  // propriete du defaut : il **arrondissait** la coupe a un minuit UTC. Une
  // heure par jour — celle qui precede ce minuit — l'arrondi est l'identite,
  // et l'ancien code se comporte alors correctement. Aucune donnee ne peut
  // distinguer les deux implementations a cet instant-la.
  //
  // On epingle donc le mecanisme plutot que sa seule consequence : le seuil ne
  // quitte pas SQL. Ni horodatage rapporte de la base pour etre relu comme une
  // heure locale, ni `toISOString()` compare a une colonne qui n'est pas au
  // meme format — les deux moities du defaut d'origine.
  // Les tests s'executent depuis `dist/` : la source TypeScript se rejoint en
  // remontant a la racine du depot, comme le fait deja `errorResponses.test.ts`.
  const source = fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..", "..", "..", "src", "messages", "manageMsgExpiration.ts",
    ),
    "utf8",
  );
  // Les commentaires racontent le defaut corrige : ils citent donc ce qu'on interdit.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  assert.doesNotMatch(code, /getCurrentTimestamp/);
  assert.doesNotMatch(code, /toISOString/);
  assert.match(code, /DATETIME\('now', \?\)/);
});

test("ferme la base a la fin de la suite", async () => {
  await closeBddInstance();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
