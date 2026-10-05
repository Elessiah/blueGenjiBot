import test from "node:test";
import assert from "node:assert/strict";

import {
    DEFAULT_TOURNAMENT_LINKS,
    MAX_TOURNAMENT_LINK_LENGTH,
    formatTournamentLinks,
    isTournamentLinkKind,
    normalizeTournamentLink,
    resolveTournamentLinks,
} from "../../tournament/tournamentLinks.js";

test("isTournamentLinkKind : les trois clés, rien d'autre", () => {
    assert.ok(isTournamentLinkKind("reglement-fr"));
    assert.ok(isTournamentLinkKind("reglement-en"));
    assert.ok(isTournamentLinkKind("cast"));
    assert.ok(!isTournamentLinkKind("toString"));
    assert.ok(!isTournamentLinkKind(""));
});

test("normalizeTournamentLink accepte une adresse https et refuse le reste", () => {
    assert.equal(normalizeTournamentLink("  https://docs.google.com/document/d/abc/edit  "), "https://docs.google.com/document/d/abc/edit");
    for (const raw of [
        "http://docs.google.com/x",
        "javascript:alert(1)",
        "docs.google.com/x",
        "https://exemple.fr/a b",
        "https://exemple.fr/a>b",
        "https://exemple.fr/(a)",
        "https://user:pass@exemple.fr/",
        "https://exemple.fr/@everyone",
        "https://exemple.fr/a?x=@Here",
        "",
        "https://exemple.fr/" + "a".repeat(MAX_TOURNAMENT_LINK_LENGTH),
    ]) {
        assert.equal(normalizeTournamentLink(raw), null, raw);
    }
});

test("normalizeTournamentLink mesure la longueur après encodage", () => {
    const accented = "https://exemple.fr/" + "é".repeat(200);
    assert.ok(accented.length <= MAX_TOURNAMENT_LINK_LENGTH);
    assert.equal(normalizeTournamentLink(accented), null);
});

test("les liens par défaut passent la validation", () => {
    for (const url of Object.values(DEFAULT_TOURNAMENT_LINKS)) {
        assert.equal(normalizeTournamentLink(url), url);
    }
});

test("resolveTournamentLinks superpose les liens valides aux défauts", () => {
    const links = resolveTournamentLinks({ "cast": "https://forms.example/x", "reglement-fr": "pas une url", "autre": "https://x.fr/" });
    assert.equal(links.cast, "https://forms.example/x");
    assert.equal(links["reglement-fr"], DEFAULT_TOURNAMENT_LINKS["reglement-fr"]);
    assert.equal(links["reglement-en"], DEFAULT_TOURNAMENT_LINKS["reglement-en"]);
    assert.ok(!("autre" in links));
});

test("formatTournamentLinks : trois liens masqués, sans aperçu", () => {
    const text = formatTournamentLinks(resolveTournamentLinks({}));
    for (const url of Object.values(DEFAULT_TOURNAMENT_LINKS)) {
        assert.ok(text.includes(`(<${url}>)`), url);
    }
    assert.ok(text.includes("Règlement (français)"));
    assert.ok(text.includes("Rules (English)"));
    assert.ok(text.includes("Formulaire pour caster"));
});
