import test from "node:test";
import assert from "node:assert/strict";

import {
  RECRUIT_ROLE_CHOICES,
  SCRIM_LEVEL_CHOICES,
  UNSPECIFIED_CHOICE_VALUE,
  normalizeLegacyChoice,
} from "../../config/searchChoices.js";

test("normalizeLegacyChoice reconnaît une valeur ou un libellé, casse et accents mis à part", () => {
  for (const raw of ["avance", "Avancé", " AVANCÉ ", "AVANCE"]) {
    assert.equal(normalizeLegacyChoice(SCRIM_LEVEL_CHOICES, raw), "avance");
  }
  assert.equal(normalizeLegacyChoice(SCRIM_LEVEL_CHOICES, "Intermédiaire"), "intermediaire");
  assert.equal(normalizeLegacyChoice(RECRUIT_ROLE_CHOICES, "DPS"), "dps");
  assert.equal(normalizeLegacyChoice(RECRUIT_ROLE_CHOICES, "Heal"), "heal");
});

test("normalizeLegacyChoice range tout le reste sous « non précisé », sans deviner", () => {
  assert.equal(UNSPECIFIED_CHOICE_VALUE, "");
  for (const raw of ["Gold 3", "PseudoDeQuelquun", "avancé+", "tank/dps", "", null]) {
    assert.equal(normalizeLegacyChoice(SCRIM_LEVEL_CHOICES, raw), UNSPECIFIED_CHOICE_VALUE);
  }
  // Un niveau n'est pas un rôle.
  assert.equal(normalizeLegacyChoice(RECRUIT_ROLE_CHOICES, "Débutant"), UNSPECIFIED_CHOICE_VALUE);
});

test("normalizeLegacyChoice laisse une valeur déjà fermée inchangée (idempotence)", () => {
  for (const choice of [...SCRIM_LEVEL_CHOICES, ...RECRUIT_ROLE_CHOICES]) {
    const choices = SCRIM_LEVEL_CHOICES.includes(choice) ? SCRIM_LEVEL_CHOICES : RECRUIT_ROLE_CHOICES;
    assert.equal(normalizeLegacyChoice(choices, choice.value), choice.value);
  }
});
