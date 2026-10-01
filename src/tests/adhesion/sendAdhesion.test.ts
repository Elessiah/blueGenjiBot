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

import { sendAdhesion } from "../../adhesion/sendAdhesion.js";

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

function fakeRole(users: User[]): Role {
  return { members: { map: <T>(fn: (m: { user: User }) => T) => users.map((user) => fn({ user })) } } as unknown as Role;
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

const NO_RECIPIENT_LOG = "sendAdhesion: aucun destinataire trouvé pour le rôle visé, envoi annulé.";
const NO_RECIPIENT_NOTICE = "Echec de l'envoi des adhésions : aucun membre du rôle visé n'a été trouvé, " +
  "personne n'a reçu les papiers. Réessayez plus tard ou vérifiez la cible !";

test("rôle vide sans membre : l'auteur est avisé, le journal sans nom, échec", async () => {
  validPaths();
  const rec = recorder();
  const ok = await sendAdhesion(fakeClient(rec), null, null, null, fakeRole([]), false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [log(NO_RECIPIENT_LOG), dm("author", NO_RECIPIENT_NOTICE)]);
});

test("membres du rôle illisibles : journalisé, le membre direct n'est pas ajouté, l'auteur avisé, échec", async () => {
  validPaths();
  const rec = recorder();
  const role = { members: { map: () => { throw new Error("kaboom"); } } } as unknown as Role;
  const ok = await sendAdhesion(fakeClient(rec), null, null, fakeMember(fakeUser(rec, "Alice")), role, false, author(rec));
  assert.equal(ok, false);
  assert.deepEqual(rec.trace, [
    log("sendAdhesion targets: kaboom"),
    log(NO_RECIPIENT_LOG),
    dm("author", NO_RECIPIENT_NOTICE),
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
