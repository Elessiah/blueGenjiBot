import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { Client, GuildMember, Role, TextChannel, User } from "discord.js";

// Le dossier des fichiers d'adhésion est relu à chaque appel : chaque test
// réécrit `paths.json` selon le cas qu'il veut provoquer.
const TMP_DIR = path.join(os.tmpdir(), "bgenji-send-adhesion-" + randomUUID());
fs.mkdirSync(TMP_DIR, { recursive: true });
process.env.ADHESIONS_PATH = TMP_DIR;
process.env.OWNER_ID = "owner-1";
process.env.INFO_SERV = "admin-channel-1";

import { sendAdhesion, sendAdhesionReminder } from "../../adhesion/sendAdhesion.js";
import type { adhesionIntervalObj } from "../../adhesion/types.js";

/**
 * Caractérisation de `sendAdhesion` : chaque scénario fige, dans l'ordre, tout
 * ce qui sort du bot — messages privés, messages de salon, journal de
 * supervision — et la valeur rendue. Une refonte doit reproduire ces traces à
 * l'identique.
 */

const DEFAULT_MESSAGE = "Voici les papiers pour l'adhésion à l'association BlueGenji :";
const FILES = ["adhesion.pdf", "statut.pdf"];

/** Une sortie observée : destinataire, texte, noms des pièces jointes. */
type Sent = { to: string; content: string; files: string[] };

type SentPayload = { content?: string; files?: Array<{ name?: string }>; embeds?: unknown };

/**
 * Enregistreur commun : tous les envois y passent dans l'ordre réel.
 * @returns La trace et une fabrique de fonctions `send` qui y écrivent.
 */
function recorder() {
  const trace: Sent[] = [];
  const sender = (to: string, fails = false) => async (payload: string | SentPayload) => {
    if (fails) throw new Error("boom");
    if (typeof payload === "string") {
      trace.push({ to, content: payload, files: [] });
    } else {
      assert.equal(payload.embeds, undefined, "aucun embed attendu");
      trace.push({ to, content: payload.content ?? "", files: (payload.files ?? []).map((f) => f.name ?? "") });
    }
    return { id: "msg-" + trace.length };
  };
  return { trace, sender };
}

type Rec = ReturnType<typeof recorder>;

function fakeClient(rec: Rec): Client {
  return {
    users: { fetch: async (id: string) => ({ id, send: rec.sender("owner") }) },
    channels: { fetch: async () => ({ send: rec.sender("log") }) },
  } as unknown as Client;
}

function fakeUser(rec: Rec, name: string, fails = false): User {
  return { id: name, globalName: name, send: rec.sender("dm:" + name, fails) } as unknown as User;
}

function fakeMember(user: User): GuildMember {
  return { user } as unknown as GuildMember;
}

/** Comportement du serveur d'un faux rôle. */
type RoleSetup = {
  /** Le cache est déjà complet : aucune récupération n'est attendue. */
  cached?: boolean;
  /** La récupération des membres du serveur lève. */
  fetchFails?: boolean;
  /** Le rôle est `@everyone` (même identifiant que le serveur). */
  everyone?: boolean;
};

/** Faux rôle et compteur des récupérations complètes de son serveur. */
type FakeRole = Role & { fetches: number };

/**
 * Faux rôle dont les membres ne sont lisibles qu'une fois le serveur récupéré,
 * comme après un redémarrage du bot. Le serveur compte un membre de plus que
 * le rôle : un rôle vide n'y passe pas pour un cache complet.
 */
function fakeRole(users: User[], setup: RoleSetup = {}): FakeRole {
  const cache = new Map<string, { user: User }>();
  const load = () => {
    cache.set("hors-role", { user: { id: "hors-role" } as unknown as User });
    for (const user of users) cache.set(user.id, { user });
  };
  if (setup.cached) load();
  const role = {
    id: setup.everyone ? "guild-1" : "role-1",
    fetches: 0,
    guild: {
      id: "guild-1",
      memberCount: users.length + 1,
      members: {
        cache,
        fetch: async () => {
          role.fetches++;
          if (setup.fetchFails) throw new Error("Members didn't arrive in time.");
          load();
        },
      },
    },
    members: { values: () => [...cache.values()].filter((m) => m.user.id !== "hors-role").values() },
  };
  return role as unknown as FakeRole;
}

function fakeChannel(rec: Rec, opts: { fails?: boolean; noGuild?: boolean } = {}): TextChannel {
  return {
    name: "general",
    guild: opts.noGuild ? undefined : { name: "Guilde" },
    send: rec.sender("channel:general", opts.fails),
  } as unknown as TextChannel;
}

function writePaths(content: string | object): void {
  fs.writeFileSync(path.join(TMP_DIR, "paths.json"), typeof content === "string" ? content : JSON.stringify(content));
}

function validPaths(): void {
  fs.writeFileSync(path.join(TMP_DIR, "adhesion.pdf"), "adhesion");
  fs.writeFileSync(path.join(TMP_DIR, "statut.pdf"), "statut");
  writePaths({
    adhesion: path.join(TMP_DIR, "adhesion.pdf"),
    adhesionName: "adhesion.pdf",
    status: path.join(TMP_DIR, "statut.pdf"),
    statusName: "statut.pdf",
  });
}

const author = (rec: Rec, fails = false) => fakeUser(rec, "author", fails);
const dm = (name: string, content: string, files: string[] = []): Sent => ({ to: "dm:" + name, content, files });
const log = (content: string): Sent => ({ to: "log", content, files: [] });

test("sans chemins configurés : l'auteur est prévenu, le journal aussi, échec", async () => {
  writePaths("null");
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, null, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [
    dm("author", "Echec de l'envoie des adhésions, impossible de récupérer les fichiers. Admin en cours de contact..."),
    log("Echec de l'envoi d'adhésion car non récupération des chemins"),
  ]);
});

test("configuration illisible : recréée vide, puis envoi à l'auteur", async () => {
  writePaths("{pas du json");
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, null, false, author(rec));
  assert.equal(ok, true);
  assert.equal(rec.trace.length, 2);
  assert.match(rec.trace[0].content, /^Impossible de lire le fichier de configuration des adhésions/);
  assert.equal(rec.trace[0].to, "log");
  assert.deepEqual(rec.trace[1], dm("author", DEFAULT_MESSAGE, ["", ""]));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(TMP_DIR, "paths.json"), "utf8")),
    { adhesion: "", adhesionName: "", status: "", statusName: "" });
});

test("aucune cible : les papiers partent en MP à l'auteur, message par défaut", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, null, false, author(rec));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace, [dm("author", DEFAULT_MESSAGE, FILES)]);
});

test("un message vide vaut le message par défaut", async () => {
  validPaths();
  const rec = recorder();
  await sendAdhesion(fakeClient(rec), "", null, null, null, false, author(rec));
  assert.deepEqual(rec.trace, [dm("author", DEFAULT_MESSAGE, FILES)]);
});

test("salon joignable : envoi au salon puis confirmation à l'auteur", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), "Bonjour", fakeChannel(rec), null, null, false, author(rec));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace, [
    { to: "channel:general", content: "Bonjour", files: FILES },
    dm("author", "Adhésion envoyé avec succès dans le channel general !"),
  ]);
});

test("salon en échec : trois essais, un seul journal, l'auteur averti, échec", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), "Bonjour", fakeChannel(rec, { fails: true }), null, null, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [
    log("SafeMessage failed  to `Guilde` : boom"),
    dm("author", "Echec de l'envoie des adhésions, vérifiez les permissions, avant de réessayer !"),
  ]);
});

test("salon dont l'envoi lève : l'exception est journalisée, l'auteur averti", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), "Bonjour", fakeChannel(rec, { fails: true, noGuild: true }), null, null, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [
    log("sendAdhesion safeChannel: Cannot read properties of undefined (reading 'name')"),
    dm("author", "Echec de l'envoie des adhésions, vérifiez les permissions, avant de réessayer !"),
  ]);
});

test("un membre : MP au membre puis confirmation nominative", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), "Salut", null, fakeMember(fakeUser(rec, "Alice")), null, false, author(rec));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace, [
    dm("Alice", "Salut", FILES),
    dm("author", "Adhésion envoyée avec succès à Alice !"),
  ]);
});

test("rôle et membre : chaque membre du rôle puis le membre, confirmation groupée", async () => {
  validPaths();
  const rec = recorder();
  const role = fakeRole([fakeUser(rec, "Bob"), fakeUser(rec, "Carol")]);
  const ok = await sendAdhesion(fakeClient(rec), null, null, fakeMember(fakeUser(rec, "Alice")), role, false, author(rec));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace, [
    dm("Bob", DEFAULT_MESSAGE, FILES),
    dm("Carol", DEFAULT_MESSAGE, FILES),
    dm("Alice", DEFAULT_MESSAGE, FILES),
    dm("author", "Adhésions envoyés avec succès à plusieurs membres !"),
  ]);
});

test("un membre injoignable : les autres reçoivent, l'auteur reçoit la liste des échecs", async () => {
  validPaths();
  const rec = recorder();
  const role = fakeRole([fakeUser(rec, "Bob", true), fakeUser(rec, "Carol"), fakeUser(rec, "Dan", true)]);
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, role, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [
    log("SafeUser failed : boom"),
    dm("Carol", DEFAULT_MESSAGE, FILES),
    log("SafeUser failed : boom"),
    dm("author", "Echec de l'envoi pour Bob\nEchec de l'envoi pour Dan\n"),
  ]);
});

test("noms d'affichage : mise en forme et mentions neutralisées, libellé neutre sans nom", async () => {
  validPaths();
  const rec = recorder();
  const named = (id: string, globalName: string | null, username: string) =>
    ({ id, globalName, username, send: rec.sender("dm:" + id, true) }) as unknown as User;
  const role = fakeRole([
    named("u1", "**Gras** @everyone", "u1"),
    named("u2", null, "pseudo_x"),
    named("u3", "  ", ""),
  ]);
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, role, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace.at(-1), dm("author",
    "Echec de l'envoi pour \\*\\*Gras\\*\\* @\u200beveryone\n" +
    "Echec de l'envoi pour pseudo\\_x\n" +
    "Echec de l'envoi pour membre sans pseudo\n"));
});

test("un membre servi sans nom d'affichage : confirmé sous son nom d'utilisateur", async () => {
  validPaths();
  const rec = recorder();
  const user = { id: "u4", globalName: null, username: "zoe", send: rec.sender("dm:u4") } as unknown as User;
  const ok = await sendAdhesion(fakeClient(rec), null, null, fakeMember(user), null, false, author(rec));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace.at(-1), dm("author", "Adhésion envoyée avec succès à zoe !"));
});

const NO_RECIPIENT_LOG = "sendAdhesion: aucun destinataire trouvé pour le rôle visé, envoi annulé.";
const NO_RECIPIENT_NOTICE = "Echec de l'envoi des adhésions en message privé : aucun membre du rôle visé n'a été trouvé, " +
  "personne ne les a reçus. Vérifiez la cible !";

test("rôle vide sans membre : l'auteur est avisé, le journal sans nom, échec", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, fakeRole([]), false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [log(NO_RECIPIENT_LOG), dm("author", NO_RECIPIENT_NOTICE)]);
});

const UNREADABLE_LOG = "sendAdhesion membres du rôle illisibles: Members didn't arrive in time.";
const unreadableNotice = (role: string) => "Echec de l'envoi des adhésions en message privé aux membres " + role +
  " : Discord n'a pas permis de les lire, aucun ne les a reçus. Réessayez plus tard en ne visant que ce rôle !";

test("cache vide après redémarrage : les membres du serveur sont récupérés, le rôle servi", async () => {
  validPaths();
  const rec = recorder();
  const role = fakeRole([fakeUser(rec, "Bob"), fakeUser(rec, "Carol")]);
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, role, false, author(rec));
  assert.equal(ok, true);
  assert.equal(role.fetches, 1);
  assert.deepEqual(rec.trace, [
    dm("Bob", DEFAULT_MESSAGE, FILES),
    dm("Carol", DEFAULT_MESSAGE, FILES),
    dm("author", "Adhésions envoyés avec succès à plusieurs membres !"),
  ]);
});

test("cache déjà complet : aucune récupération (limite de débit), le rôle servi", async () => {
  validPaths();
  const rec = recorder();
  const role = fakeRole([fakeUser(rec, "Bob")], { cached: true });
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, role, false, author(rec));
  assert.equal(ok, true);
  assert.equal(role.fetches, 0);
  assert.deepEqual(rec.trace, [dm("Bob", DEFAULT_MESSAGE, FILES), dm("author", "Adhésion envoyée avec succès à Bob !")]);
});

test("les bots du rôle sont écartés : ni MP ni échec compté", async () => {
  validPaths();
  const rec = recorder();
  const robot = Object.assign(fakeUser(rec, "Robot", true), { bot: true });
  const role = fakeRole([robot, fakeUser(rec, "Bob")]);
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, role, false, author(rec));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace, [dm("Bob", DEFAULT_MESSAGE, FILES), dm("author", "Adhésion envoyée avec succès à Bob !")]);
});

test("beaucoup d'échecs : l'avis à l'auteur reste sous 2000 caractères et compte le reste", async () => {
  validPaths();
  const rec = recorder();
  const users = Array.from({ length: 50 }, (_, i) => fakeUser(rec, "Membre-au-nom-assez-long-" + i, true));
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, fakeRole(users), false, author(rec));
  assert.equal(ok, false);
  const notice = rec.trace.at(-1);
  assert.equal(notice?.to, "dm:author");
  assert.ok((notice?.content.length ?? 0) <= 2000);
  const shown = (notice?.content.match(/^Echec de l'envoi pour /gm) ?? []).length;
  assert.ok((notice?.content ?? "").endsWith("Et " + (50 - shown) + " autre(s) échec(s).\n"));
});

const EVERYONE_LOG = "sendAdhesion: rôle @everyone visé, envoi en MP refusé.";
const EVERYONE_NOTICE = "Envoi refusé : le rôle @​everyone ne peut pas être visé, " +
  "il enverrait les adhésions en message privé à tout le serveur. " +
  "Visez un rôle plus restreint, ou envoyez-les dans un salon !";

test("@everyone : refusé à l'envoi, sans récupération du serveur ni MP, même au membre désigné", async () => {
  validPaths();
  const rec = recorder();
  const role = fakeRole([fakeUser(rec, "Bob")], { everyone: true, cached: true });
  const ok = await sendAdhesion(fakeClient(rec), null, null, fakeMember(fakeUser(rec, "Alice")), role, false, author(rec));
  assert.equal(ok, false);
  assert.equal(role.fetches, 0);
  assert.deepEqual(rec.trace, [log(EVERYONE_LOG), dm("author", EVERYONE_NOTICE)]);
});

test("@everyone dans un rappel enregistré : refusé, le salon est servi quand même", async () => {
  validPaths();
  const rec = recorder();
  const bob = fakeUser(rec, "Bob");
  const interval = {
    message: "", channel: fakeChannel(rec), member: null, role: fakeRole([bob], { everyone: true }),
    roleMembers: [fakeMember(bob)], author: author(rec),
  } as unknown as adhesionIntervalObj;
  const ok = await sendAdhesionReminder(fakeClient(rec), interval);
  assert.equal(ok, false);
  assert.equal(rec.trace.some((t) => t.to === "dm:Bob"), false);
  assert.equal(rec.trace[0].to, "channel:general");
  assert.deepEqual(rec.trace.slice(-2), [log(EVERYONE_LOG), dm("author", EVERYONE_NOTICE)]);
});

const users = (rec: Rec, n: number) => Array.from({ length: n }, (_, i) => fakeUser(rec, "M" + i));
const capNotice = (count: string) => "Envoi en message privé refusé : Le rôle « Membres » compte " + count +
  ", au-delà de la limite de 50 messages privés par envoi. Personne n'a reçu les adhésions. " +
  "Visez un rôle plus restreint, ou envoyez-les dans un salon !";

test("plafond : 50 membres du rôle sont tous servis", async () => {
  validPaths();
  const rec = recorder();
  const role = Object.assign(fakeRole(users(rec, 50)), { name: "Membres" });
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, role, false, author(rec));
  assert.equal(ok, true);
  assert.equal(rec.trace.filter((t) => t.to.startsWith("dm:M")).length, 50);
});

test("plafond : 51 membres, rien ne part, l'auteur apprend le compte et la limite, journal sans nom", async () => {
  validPaths();
  const rec = recorder();
  const role = Object.assign(fakeRole(users(rec, 51)), { name: "Membres" });
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, role, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [
    log("sendAdhesion: 51 destinataires au-delà du plafond de 50, envoi en MP refusé."),
    dm("author", capNotice("51 membres")),
  ]);
});

test("plafond : 50 membres du rôle plus un membre désigné dépassent la limite, personne n'est servi", async () => {
  validPaths();
  const rec = recorder();
  const role = Object.assign(fakeRole(users(rec, 50)), { name: "Membres" });
  const ok = await sendAdhesion(fakeClient(rec), null, null, fakeMember(fakeUser(rec, "Alice")), role, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [
    log("sendAdhesion: 51 destinataires au-delà du plafond de 50, envoi en MP refusé."),
    dm("author", capNotice("50 membres (51 messages privés avec le membre désigné)")),
  ]);
});

test("plafond : un membre désigné déjà du rôle n'est compté et servi qu'une fois", async () => {
  validPaths();
  const rec = recorder();
  const members = users(rec, 50);
  const role = Object.assign(fakeRole(members), { name: "Membres" });
  const ok = await sendAdhesion(fakeClient(rec), null, null, fakeMember(members[0]), role, false, author(rec));
  assert.equal(ok, true);
  assert.equal(rec.trace.filter((t) => t.to === "dm:M0").length, 1);
  assert.equal(rec.trace.filter((t) => t.to.startsWith("dm:M")).length, 50);
});

test("plafond : 49 membres du rôle plus un membre désigné restent servis", async () => {
  validPaths();
  const rec = recorder();
  const role = Object.assign(fakeRole(users(rec, 49)), { name: "Membres" });
  const ok = await sendAdhesion(fakeClient(rec), null, null, fakeMember(fakeUser(rec, "Alice")), role, false, author(rec));
  assert.equal(ok, true);
  assert.equal(rec.trace.filter((t) => t.to.startsWith("dm:")).length, 51);
});

test("plafond : un salon demandé avec un rôle trop grand est servi, les MP refusés", async () => {
  validPaths();
  const rec = recorder();
  const role = Object.assign(fakeRole(users(rec, 60)), { name: "Membres" });
  const ok = await sendAdhesion(fakeClient(rec), null, fakeChannel(rec), null, role, false, author(rec));
  assert.equal(ok, false);
  assert.equal(rec.trace[0].to, "channel:general");
  assert.equal(rec.trace.some((t) => t.to.startsWith("dm:M")), false);
  assert.deepEqual(rec.trace.at(-1), dm("author", capNotice("60 membres")));
});

test("membres du rôle déjà lus (rappel) : servis tels quels, sans seconde lecture qui pourrait échouer", async () => {
  validPaths();
  const rec = recorder();
  const bob = fakeUser(rec, "Bob");
  const role = fakeRole([bob], { fetchFails: true });
  const interval = {
    message: "", channel: null, member: null, role, roleMembers: [fakeMember(bob)], author: author(rec),
  } as unknown as adhesionIntervalObj;
  const ok = await sendAdhesionReminder(fakeClient(rec), interval);
  assert.equal(ok, true);
  assert.equal(role.fetches, 0);
  assert.deepEqual(rec.trace, [dm("Bob", DEFAULT_MESSAGE, FILES), dm("author", "Adhésion envoyée avec succès à Bob !")]);
});

test("membres du rôle illisibles : journalisé sans nom, le membre désigné servi quand même, échec", async () => {
  validPaths();
  const rec = recorder();
  const role = Object.assign(fakeRole([fakeUser(rec, "Bob")], { fetchFails: true }), { name: "Bureau" });
  const ok = await sendAdhesion(fakeClient(rec), null, null, fakeMember(fakeUser(rec, "Alice")), role, false, author(rec));
  assert.equal(ok, false);
  assert.equal(role.fetches, 1);
  assert.deepEqual(rec.trace, [
    log(UNREADABLE_LOG),
    dm("author", unreadableNotice("du rôle « Bureau »")),
    dm("Alice", DEFAULT_MESSAGE, FILES),
    dm("author", "Adhésion envoyée avec succès à Alice !"),
  ]);
  assert.ok(!rec.trace.some((t) => t.to === "log" && /Bob|Alice/.test(t.content)), "aucun pseudo au journal");
});

test("membres du rôle illisibles sans membre désigné : un seul avis, pas celui du rôle vide, échec", async () => {
  validPaths();
  const rec = recorder();
  const role = fakeRole([fakeUser(rec, "Bob")], { fetchFails: true });
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, role, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [log(UNREADABLE_LOG), dm("author", unreadableNotice("du rôle visé"))]);
});

test("rôle vide nommé : l'avis nomme le rôle, sans mise en forme Discord", async () => {
  validPaths();
  const rec = recorder();
  const role = Object.assign(fakeRole([]), { name: "**Bureau** _2026_" });
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, role, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [
    log(NO_RECIPIENT_LOG),
    dm("author", String.raw`Echec de l'envoi des adhésions en message privé : aucun membre du rôle « \*\*Bureau\*\* \_2026\_ » n'a été trouvé, personne ne les a reçus. Vérifiez la cible !`),
  ]);
});

test("salon servi mais rôle vide : le salon reçoit, l'auteur est avisé des deux, échec", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), null, fakeChannel(rec), null, fakeRole([]), false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [
    { to: "channel:general", content: DEFAULT_MESSAGE, files: FILES },
    dm("author", "Adhésion envoyé avec succès dans le channel general !"),
    log(NO_RECIPIENT_LOG),
    dm("author", NO_RECIPIENT_NOTICE),
  ]);
});

test("rôle vide et auteur injoignable : l'avis manqué est journalisé, toujours un échec", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, fakeRole([]), false, author(rec, true));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [log(NO_RECIPIENT_LOG), log("SafeUser failed : boom")]);
});

test("salon et membre : le salon d'abord, puis les membres, chacun confirmé", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), "Yo", fakeChannel(rec), fakeMember(fakeUser(rec, "Alice")), null, false, author(rec));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace, [
    { to: "channel:general", content: "Yo", files: FILES },
    dm("author", "Adhésion envoyé avec succès dans le channel general !"),
    dm("Alice", "Yo", FILES),
    dm("author", "Adhésion envoyée avec succès à Alice !"),
  ]);
});

test("salon en échec : les membres sont tout de même servis, échec global", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), "Yo", fakeChannel(rec, { fails: true }), fakeMember(fakeUser(rec, "Alice")), null, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [
    log("SafeMessage failed  to `Guilde` : boom"),
    dm("author", "Echec de l'envoie des adhésions, vérifiez les permissions, avant de réessayer !"),
    dm("Alice", "Yo", FILES),
    dm("author", "Adhésion envoyée avec succès à Alice !"),
  ]);
});

test("auteur injoignable : l'échec de sa confirmation ne change pas le résultat", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), "Yo", fakeChannel(rec), null, null, false, author(rec, true));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace, [
    { to: "channel:general", content: "Yo", files: FILES },
    log("SafeUser failed : boom"),
  ]);
});

test("permissions manquantes avec cibles : rien hors MP, l'auteur reçoit les papiers et l'avertissement", async () => {
  validPaths();
  const rec = recorder();
  const role = fakeRole([fakeUser(rec, "Bob")]);
  const ok = await sendAdhesion(fakeClient(rec), "Yo", fakeChannel(rec), fakeMember(fakeUser(rec, "Alice")), role, true, author(rec));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace, [
    dm("author", "Yo\nVous n'avez pas les permissions pour envoyer un message ailleurs que dans vos MP !", FILES),
  ]);
});

test("permissions manquantes sans cible : MP à l'auteur sans avertissement", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, null, true, author(rec));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace, [dm("author", DEFAULT_MESSAGE, FILES)]);
});

test("permissions manquantes, auteur injoignable : journalisé, résultat inchangé", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), null, fakeChannel(rec), null, null, true, author(rec, true));
  assert.equal(ok, true);
  assert.deepEqual(rec.trace, [log("SafeUser failed : boom")]);
});

test.after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
