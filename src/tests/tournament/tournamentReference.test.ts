import test from "node:test";
import assert from "node:assert/strict";
import { parseTournamentReference } from "../../tournament/tournamentReference.js";

// Désignation d'un tournoi dans /message-tournoi : numéro, ou lien vers sa fiche (le site n'a pas de slug).

test("parseTournamentReference_bareNumber_returnsId", () => {
  assert.equal(parseTournamentReference(" 12 "), 12);
});

test("parseTournamentReference_hashNumber_returnsId", () => {
  assert.equal(parseTournamentReference("#12"), 12);
});

test("parseTournamentReference_frenchLink_returnsId", () => {
  assert.equal(parseTournamentReference("https://bluegenji-esport.fr/tournois/12"), 12);
});

test("parseTournamentReference_englishLinkWithSubPathQueryAndHash_returnsId", () => {
  assert.equal(parseTournamentReference("https://bluegenji-esport.fr/en/tournois/12/matchs/3?tab=x#match-3"), 12);
});

test("parseTournamentReference_spectatorLink_returnsId", () => {
  assert.equal(parseTournamentReference("https://bluegenji-esport.fr/suivre/tournois/7"), 7);
});

test("parseTournamentReference_linkWithoutScheme_returnsId", () => {
  assert.equal(parseTournamentReference("bluegenji-esport.fr/tournois/12/"), 12);
});

test("parseTournamentReference_sitePath_returnsId", () => {
  assert.equal(parseTournamentReference("/tournois/12?x=1"), 12);
});

test("parseTournamentReference_upperCasePath_returnsId", () => {
  assert.equal(parseTournamentReference("https://bluegenji-esport.fr/EN/Tournois/12"), 12);
});

test("parseTournamentReference_name_returnsNull", () => {
  assert.equal(parseTournamentReference("coupe-d-hiver"), null);
});

test("parseTournamentReference_zero_returnsNull", () => {
  assert.equal(parseTournamentReference("0"), null);
});

test("parseTournamentReference_otherPage_returnsNull", () => {
  assert.equal(parseTournamentReference("https://bluegenji-esport.fr/equipes/12"), null);
});

test("parseTournamentReference_tournamentListWithoutNumber_returnsNull", () => {
  assert.equal(parseTournamentReference("https://bluegenji-esport.fr/tournois/abc"), null);
});

test("parseTournamentReference_numberGlued_toLetters_returnsNull", () => {
  assert.equal(parseTournamentReference("https://bluegenji-esport.fr/tournois/12abc"), null);
});

test("parseTournamentReference_nonHttpScheme_returnsNull", () => {
  assert.equal(parseTournamentReference("javascript:alert(1)//tournois/12"), null);
});

test("parseTournamentReference_empty_returnsNull", () => {
  assert.equal(parseTournamentReference("   "), null);
});
