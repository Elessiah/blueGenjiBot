import test from "node:test";
import assert from "node:assert/strict";
import { toSQLiteDate } from "../../utils/toSQLiteDatetime.js";

test("toSQLiteDate rend le format DATETIME de SQLite", () => {
  assert.equal(toSQLiteDate(new Date("2026-09-10T18:30:45.000Z")), "2026-09-10 18:30:45");
});

test("toSQLiteDate ecrit en UTC, pas dans le fuseau du serveur", () => {
  // Le point a retenir : la conversion passe par toISOString(). Une date lue
  // avec ce format doit donc etre relue comme de l'UTC, jamais comme du local.
  const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  assert.equal(toSQLiteDate(date), "2026-01-02 03:04:05");
});

test("toSQLiteDate coupe les millisecondes", () => {
  assert.equal(toSQLiteDate(new Date("2026-09-10T18:30:45.987Z")), "2026-09-10 18:30:45");
});

test("toSQLiteDate garde les zeros de tete", () => {
  assert.equal(toSQLiteDate(new Date("2026-01-05T04:05:06.000Z")), "2026-01-05 04:05:06");
});

test("toSQLiteDate ne laisse ni T ni Z", () => {
  const formatted = toSQLiteDate(new Date("2026-09-10T18:30:45.000Z"));
  assert.ok(!formatted.includes("T"));
  assert.ok(!formatted.includes("Z"));
  assert.equal(formatted.length, 19);
});
