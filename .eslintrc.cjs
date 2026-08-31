/**
 * Configuration ESLint du bot.
 *
 * Format `.eslintrc` et non « flat config » : ESLint 8 ne lit le second que
 * derrière un drapeau d'environnement, qu'il faudrait alors poser dans chaque
 * script et dans la CI. Le jour où le projet passera à ESLint 9, la conversion
 * se fera d'un bloc.
 *
 * Le périmètre est **`src/` seul** (`.eslintignore`) : sans lui, `eslint .`
 * partait analyser `dist/` — du JavaScript compilé, sans configuration
 * TypeScript — et échouait avant même d'avoir lu une ligne de source.
 */
module.exports = {
  root: true,
  env: { node: true, es2022: true },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
  },
  // `import` est activé pour que les `eslint-disable` déjà posés dans le code
  // (`import/no-named-as-default` dans `bdd/Bdd.ts`) résolvent leur règle.
  plugins: ["@typescript-eslint", "import"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    // Le projet est en `strict` mais avec `noImplicitAny: false`, et beaucoup de
    // frontières Discord/SQLite sont typées `any` à dessein. On le signale sans
    // bloquer la livraison.
    "@typescript-eslint/no-explicit-any": "warn",
    // Un `_` en tête marque un paramètre gardé pour la signature commune des
    // handlers de commande (`(_client, interaction)`).
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
    ],
    "no-unused-vars": "off",
    // `catch {}` est l'idiome du projet pour « on a déjà ce qu'il faut, l'échec
    // ne change rien » : le bot ne doit jamais tomber sur une erreur secondaire.
    "no-empty": ["error", { allowEmptyCatch: true }],
  },
};
