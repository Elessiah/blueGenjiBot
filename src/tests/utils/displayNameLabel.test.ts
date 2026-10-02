import test from "node:test";
import assert from "node:assert/strict";

import { displayNameLabel, NO_DISPLAY_NAME } from "../../utils/displayNameLabel.js";

const label = (globalName: string | null, username = "user") => displayNameLabel({ globalName, username });

test("nom ordinaire : rendu tel quel", () => {
  assert.equal(label("Alice"), "Alice");
  assert.equal(label("Équipe Bleue 2"), "Équipe Bleue 2");
});

test("mise en forme Discord : échappée", () => {
  assert.equal(label("**gras** _it_ ~~barré~~ ||spoil|| `code`"), "\\*\\*gras\\*\\* \\_it\\_ \\~\\~barré\\~\\~ \\|\\|spoil\\|\\| \\`code\\`");
});

test("lien masqué : ne forme plus de lien", () => {
  // Le crochet ouvrant échappé, Discord n'assemble plus libellé et adresse.
  assert.equal(label("[clique](https://exemple.invalid)"), "\\[clique](https://exemple.invalid)");
});

test("mentions : @everyone, @here, <@id> et <@&id> ne mentionnent plus", () => {
  assert.equal(label("@everyone"), "@​everyone");
  assert.equal(label("salut @here"), "salut @​here");
  assert.equal(label("<@123>"), "<@​123>");
  assert.equal(label("<@&456>"), "<@​&456>");
});

test("sans nom d'affichage : le nom d'utilisateur, échappé lui aussi", () => {
  assert.equal(label(null, "pseudo_x"), "pseudo\\_x");
});

test("aucun nom lisible : libellé neutre", () => {
  assert.equal(label(null, ""), NO_DISPLAY_NAME);
  assert.equal(label("   ", " \n "), NO_DISPLAY_NAME);
  assert.equal(displayNameLabel({ globalName: null, username: undefined as unknown as string }), NO_DISPLAY_NAME);
  assert.equal(NO_DISPLAY_NAME, "membre sans pseudo");
});

test("blancs : réduits à une espace, sans saut de ligne", () => {
  assert.equal(label("  Bob \n\n Dylan  "), "Bob Dylan");
});
