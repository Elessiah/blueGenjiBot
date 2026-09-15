import test from "node:test";
import assert from "node:assert/strict";

import { escapeLinkLabel } from "../../utils/escapeLinkLabel.js";

test("escapeLinkLabel laisse intact un nom sans delimiteur", () => {
  assert.equal(escapeLinkLabel("BlueGenji Esport"), "BlueGenji Esport");
  assert.equal(escapeLinkLabel(""), "");
  assert.equal(escapeLinkLabel("Team #1 — EU"), "Team #1 — EU");
});

test("escapeLinkLabel empeche un nom de serveur de refermer le lien", () => {
  assert.equal(
    escapeLinkLabel("](https://exemple.invalid)["),
    "\\]\\(https://exemple.invalid\\)\\[",
  );
});

test("escapeLinkLabel echappe les parentheses d'un nom legitime", () => {
  assert.equal(escapeLinkLabel("Team (EU)"), "Team \\(EU\\)");
});

test("escapeLinkLabel echappe la barre oblique inverse elle-meme", () => {
  // Sans ce cas, un nom terminant par une barre echapperait le crochet que
  // l'on vient d'ecrire, et le libelle se refermerait quand meme.
  assert.equal(escapeLinkLabel("a\\b"), "a\\\\b");
  assert.equal(escapeLinkLabel("fin\\]"), "fin\\\\\\]");
});
