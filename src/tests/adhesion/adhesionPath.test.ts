import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { adhesionDir, adhesionFilePath } from "../../adhesion/adhesionPath.js";

/** Pose `ADHESIONS_PATH` le temps d'un cas, puis rend l'environnement intact. */
function withAdhesionsPath<T>(value: string | undefined, run: () => T): T {
  const previous = process.env.ADHESIONS_PATH;
  if (value === undefined) {
    delete process.env.ADHESIONS_PATH;
  } else {
    process.env.ADHESIONS_PATH = value;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      delete process.env.ADHESIONS_PATH;
    } else {
      process.env.ADHESIONS_PATH = previous;
    }
  }
}

test("adhesionDir retombe sur le dossier courant sans la variable", () => {
  // La concatenation d'origine rendait "undefined" + le nom du fichier : le
  // bot ecrivait un "undefinedpaths.json" sans le signaler.
  withAdhesionsPath(undefined, () => {
    assert.equal(adhesionDir(), ".");
    assert.equal(adhesionFilePath("paths.json"), path.join(".", "paths.json"));
  });
  withAdhesionsPath("", () => {
    assert.equal(adhesionDir(), ".");
  });
});

test("adhesionFilePath ajoute le separateur manquant", () => {
  // Sans barre finale, "/opt/adhesions" + "paths.json" designait un chemin
  // frere du dossier vise, pas un fichier dedans.
  withAdhesionsPath("/opt/adhesions", () => {
    assert.equal(adhesionFilePath("paths.json"), path.join("/opt/adhesions", "paths.json"));
  });
  withAdhesionsPath("/opt/adhesions/", () => {
    assert.equal(adhesionFilePath("paths.json"), path.join("/opt/adhesions", "paths.json"));
  });
});

test("adhesionFilePath confine un nom de piece jointe au dossier de stockage", () => {
  withAdhesionsPath("/opt/adhesions/", () => {
    assert.equal(
      adhesionFilePath("../../etc/cron.d/backdoor"),
      path.join("/opt/adhesions", "backdoor"),
    );
    assert.equal(adhesionFilePath("statuts.pdf"), path.join("/opt/adhesions", "statuts.pdf"));
  });
});

test("adhesionFilePath ne remonte jamais au-dessus du dossier de stockage", () => {
  withAdhesionsPath("/opt/adhesions/", () => {
    for (const name of ["..", ".", "../..", "/etc/passwd", "sous/dossier/fichier.pdf"]) {
      const resolved = path.resolve(adhesionFilePath(name));
      const root = path.resolve("/opt/adhesions");
      assert.equal(
        resolved === root || resolved.startsWith(root + path.sep),
        true,
        `"${name}" est sorti du dossier : ${resolved}`,
      );
    }
  });
});
