import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import fs from "node:fs";

const TMP_DB = path.join(os.tmpdir(), `bgenji-tournament-${randomUUID()}.sqlite`);
process.env.BDD_PATH = TMP_DB;

import { getBddInstance, closeBddInstance } from "../../bdd/Bdd.js";

test("getTournamentLinks est vide tant qu'aucun lien n'est remplacé", async () => {
    const bdd = await getBddInstance();
    assert.deepEqual(await bdd.getTournamentLinks(), {});
});

test("setTournamentLink insère puis remplace sans dupliquer", async () => {
    const bdd = await getBddInstance();
    assert.equal((await bdd.setTournamentLink("cast", "https://a.fr/1")).success, true);
    assert.equal((await bdd.setTournamentLink("cast", "https://a.fr/2")).success, true);
    assert.deepEqual(await bdd.getTournamentLinks(), { cast: "https://a.fr/2" });
    const rows = await bdd.raw<{ n: number }>("SELECT COUNT(*) AS n FROM TournamentLink");
    assert.equal(Number(rows[0].n), 1);
});

test("setTournamentLink(null) rend le lien par défaut", async () => {
    const bdd = await getBddInstance();
    await bdd.setTournamentLink("reglement-fr", "https://a.fr/fr");
    assert.equal((await bdd.setTournamentLink("reglement-fr", null)).success, true);
    assert.ok(!("reglement-fr" in await bdd.getTournamentLinks()));
});

test.after(async () => {
    await closeBddInstance();
    if (fs.existsSync(TMP_DB)) {
        fs.unlinkSync(TMP_DB);
    }
});
