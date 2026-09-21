import test from "node:test";
import assert from "node:assert/strict";

import {
  FEED_ANONYMOUS_ACTOR,
  isSnowflake,
  scrubFeedField,
  scrubFeedText,
} from "../../feed/feedPrivacy.js";

const ID = "100000000000000001";

test("isSnowflake reconnait un identifiant Discord et lui seul", () => {
  assert.equal(isSnowflake(ID), true);
  assert.equal(isSnowflake("12345678901234567"), true); // 17 chiffres
  assert.equal(isSnowflake("12345678901234567890"), true); // 20
  assert.equal(isSnowflake(` ${ID} `), true);

  assert.equal(isSnowflake("1234567890123456"), false); // 16
  assert.equal(isSnowflake("123456789012345678901"), false); // 21
  assert.equal(isSnowflake(""), false);
  assert.equal(isSnowflake("GuildA"), false);
  assert.equal(isSnowflake(`<@${ID}>`), false);
});

test("scrubFeedText remplace l'identifiant du code de connexion", () => {
  assert.equal(
    scrubFeedText(`Code DM envoye a ${ID}`),
    `Code DM envoye a ${FEED_ANONYMOUS_ACTOR}`,
  );
});

test("scrubFeedText avale la mention entiere, chevrons compris", () => {
  // Traiter l'identifiant nu d'abord laisserait `<@un joueur>`.
  assert.equal(
    scrubFeedText(`Recherche DPS par <@${ID}>`),
    `Recherche DPS par ${FEED_ANONYMOUS_ACTOR}`,
  );
  assert.equal(scrubFeedText(`<@!${ID}>`), FEED_ANONYMOUS_ACTOR);
});

test("scrubFeedText traite plusieurs personnes dans la meme phrase", () => {
  const out = scrubFeedText(`<@${ID}> a invite 100000000000000002`);
  assert.equal(out, `${FEED_ANONYMOUS_ACTOR} a invite ${FEED_ANONYMOUS_ACTOR}`);
  assert.equal(/\d{17}/.test(out), false);
});

test("scrubFeedText laisse intacts les nombres que le flux porte legitimement", () => {
  assert.equal(scrubFeedText("LFS vers 6 salon(s)"), "LFS vers 6 salon(s)");
  assert.equal(scrubFeedText("Scrim Overwatch niveau 3"), "Scrim Overwatch niveau 3");
  assert.equal(scrubFeedText("2026-09-21 08:21:14"), "2026-09-21 08:21:14");
});

test("scrubFeedText ne rogne pas un nombre plus long qu'un identifiant", () => {
  const long = "1".repeat(24);
  assert.equal(scrubFeedText(long), long);
});

test("scrubFeedField efface une colonne qui n'est qu'un identifiant", () => {
  assert.equal(scrubFeedField(ID), null);
  assert.equal(scrubFeedField(` ${ID} `), null);
});

test("scrubFeedField conserve un nom de serveur", () => {
  assert.equal(scrubFeedField("GuildA"), "GuildA");
  assert.equal(scrubFeedField("user-123"), "user-123");
});

test("scrubFeedField nettoie un identifiant noye dans une autre valeur", () => {
  assert.equal(scrubFeedField(`serveur de ${ID}`), `serveur de ${FEED_ANONYMOUS_ACTOR}`);
});

test("scrubFeedField rend null sur l'absence de valeur", () => {
  assert.equal(scrubFeedField(null), null);
  assert.equal(scrubFeedField(undefined), null);
  assert.equal(scrubFeedField(""), null);
});
