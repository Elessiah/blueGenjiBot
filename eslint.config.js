/**
 * Configuration ESLint du bot (format « flat », ESLint 10).
 *
 * Le périmètre est **`src/` seul** : sans les `ignores` ci-dessous, `eslint .`
 * partirait analyser `dist/` — du JavaScript compilé, sans configuration
 * TypeScript — et échouerait avant même d'avoir lu une ligne de source.
 */
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/",
      "dist/",
      "docs/",
      "doc/",
      "coverage/",
      // Ancien point d'entrée JavaScript, remplacé par `src/main.ts`. Il n'est
      // pas compilé (`allowJs: false`) ni référencé par `package.json` :
      // l'analyser reviendrait à corriger du code mort.
      "src/main.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      // Le projet est en `strict` mais avec `noImplicitAny: false`, et beaucoup
      // de frontières Discord/SQLite sont typées `any` à dessein. On le signale
      // sans bloquer la livraison.
      "@typescript-eslint/no-explicit-any": "warn",
      // Un `_` en tête marque un paramètre gardé pour la signature commune des
      // handlers de commande (`(_client, interaction)`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-unused-vars": "off",
      // `catch {}` est l'idiome du projet pour « on a déjà ce qu'il faut,
      // l'échec ne change rien » : le bot ne doit jamais tomber sur une erreur
      // secondaire.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
