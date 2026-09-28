import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Deux TypeScript cohabitent : `typescript-native` (TypeScript 7, compilateur
 * en Go) produit `dist/`, et `typescript` (5.x) reste celui que chargent
 * typescript-eslint et ts-node — TypeScript 7 n'expose plus l'API JavaScript
 * qu'ils appellent. Ce test garde le câblage qui tient cette cohabitation.
 */
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};
const TSCONFIG = fs.readFileSync(path.join(ROOT, "tsconfig.json"), "utf8");

test("le build compile avec TypeScript 7, désigné par chemin", () => {
  // Les deux paquets fournissent un binaire `tsc` : celui que retient
  // `node_modules/.bin` dépend de l'ordre d'installation.
  assert.match(pkg.scripts.build, /^node node_modules\/typescript-native\/bin\/tsc && tsc-alias$/);
  assert.match(pkg.scripts["typecheck:ts5"], /^node node_modules\/typescript\/bin\/tsc /);
});

test("TypeScript 7 est installé à côté de TypeScript 5, sans le remplacer", () => {
  assert.match(pkg.devDependencies.typescript, /^\^5/);
  assert.match(pkg.devDependencies["typescript-native"], /^npm:typescript@\^7/);
});

test("tsconfig.json ne pose aucune option retirée de TypeScript 7", () => {
  assert.doesNotMatch(TSCONFIG, /"baseUrl"/);
  assert.match(TSCONFIG, /"@\/\*": \["\.\/src\/\*"\]/);
});
