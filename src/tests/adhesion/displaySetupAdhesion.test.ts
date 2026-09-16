import test from "node:test";
import assert from "node:assert/strict";

import { buildEmbedPage, formatCadence } from "../../commandsHandlers/adhesions/displaySetupAdhesion.js";
import type { adhesionIntervalIds } from "../../adhesion/types.js";

/** Une ligne de `AdhesionInterval` telle qu'elle sort de la base. */
function row(over: Partial<adhesionIntervalIds> = {}): adhesionIntervalIds {
  return {
    id: 1,
    message: "Pense a ton adhesion",
    iteration: -1,
    guild_id: "676570513023172637",
    channel_id: null,
    member_id: "794576759253106708",
    role_id: null,
    author_id: "813121513212739655",
    interval_days: 14,
    nextTransmission: new Date("2026-10-01T08:00:00.000Z"),
    ...over,
  };
}

test("liste aussi les rappels a nombre d'envois fini", () => {
  // Le defaut d'origine : `items.filter(i => i.iteration == -1)` ecartait tout
  // ce que pose `/adhesion-valide`. Ces rappels partaient quand meme, et comme
  // `/delete-rappel-adhesion` reclame l'ID que seule cette liste donne, ils
  // etaient impossibles a annuler.
  const page = buildEmbedPage([row({ id: 7, iteration: 1, interval_days: 0 })], 0, 5);
  const desc = page.embed.data.description ?? "";

  assert.match(desc, /#7/);
  assert.doesNotMatch(desc, /Aucun rappel programmé/);
});

test("une liste faite uniquement de rappels de peremption n'est plus vide", () => {
  // C'est le symptome rapporte, mot pour mot : la commande ne remontait rien
  // pendant que des membres recevaient des rappels.
  const page = buildEmbedPage([row({ id: 2, iteration: 1 }), row({ id: 3, iteration: 2 })], 0, 5);
  const desc = page.embed.data.description ?? "";

  assert.match(desc, /#2/);
  assert.match(desc, /#3/);
});

test("pagine sur la liste affichee, pas sur un total different", () => {
  // `totalPages` se calculait sur `items` entier alors que le decoupage portait
  // sur une liste filtree : la commande annoncait des pages qu'elle remplissait
  // d'un « Aucun rappel programme ».
  const items = Array.from({ length: 12 }, (_, i) => row({ id: i + 1, iteration: i < 3 ? -1 : 1 }));
  const first = buildEmbedPage(items, 0, 5);
  const last = buildEmbedPage(items, first.totalPages - 1, 5);

  assert.equal(first.totalPages, 3);
  assert.notEqual(last.embed.data.description, "Aucun rappel programmé.");
});

test("borne la page demandee des deux cotes", () => {
  const items = [row({ id: 1 }), row({ id: 2 })];
  assert.equal(buildEmbedPage(items, -4, 5).page, 0);
  assert.equal(buildEmbedPage(items, 99, 5).page, 0);
});

test("rend les cibles en mentions, sans rien demander a Discord", () => {
  // L'affichage passait par `fetchTargets`, qui supprime l'intervalle quand une
  // cible ne repond pas : une commande de lecture effacait ce qu'elle lisait.
  const desc =
    buildEmbedPage([row({ member_id: "42", role_id: "43", channel_id: "44" })], 0, 5).embed.data
      .description ?? "";

  assert.match(desc, /<@42>/);
  assert.match(desc, /<@&43>/);
  assert.match(desc, /<#44>/);
});

test("signale un rappel sans aucune cible", () => {
  // La ligne n4 de la base de production : recurrent, sans cible et sans
  // message. Il partait en prive a son auteur, ce que rien n'indiquait.
  const desc =
    buildEmbedPage([row({ member_id: null, role_id: null, channel_id: null })], 0, 5).embed.data
      .description ?? "";

  assert.match(desc, /Aucune cible/);
});

test("un rappel sans message ne rend pas un titre vide", () => {
  const desc = buildEmbedPage([row({ message: "" })], 0, 5).embed.data.description ?? "";
  assert.match(desc, /sans message/);
});

test("une liste vide le dit, au lieu d'annoncer une page pleine", () => {
  const page = buildEmbedPage([], 0, 5);
  assert.equal(page.totalPages, 1);
  assert.match(page.embed.data.description ?? "", /Aucun rappel programmé/);
});

test("formatCadence distingue le recurrent du fini", () => {
  assert.match(formatCadence(row({ iteration: -1, interval_days: 30 })), /30j/);
  assert.match(formatCadence(row({ iteration: 1 })), /1 envoi restant/);
  assert.match(formatCadence(row({ iteration: 3 })), /3 envois restants/);
});
