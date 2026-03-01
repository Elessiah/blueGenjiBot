{
  "root": true,
    "parser": "@typescript-eslint/parser",
    "parserOptions": {
  "ecmaVersion": "latest",
      "sourceType": "module",
      "project": "./tsconfig.json",
      "tsconfigRootDir": "./"
},
  "env": {
  "node": true,
      "es2022": true
},
  "extends": [
  "eslint:recommended",
  "standard",
  "plugin:@typescript-eslint/recommended",
  "plugin:@typescript-eslint/recommended-type-checked",
  "plugin:import/typescript"
],
    "rules": {
  /* Migration JS -> TS : types sur l'API (exports), pas partout */
  "@typescript-eslint/explicit-module-boundary-types": "warn",

      /* Garde-fous TS utiles en migration */
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-floating-promises": ["warn", { "ignoreVoid": true }],

      /* Désactivé pour éviter la friction pendant la migration */
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-member-accessibility": "off",
      "@typescript-eslint/no-explicit-any": "off",

      /* Trop bruyant en migration (tu peux les réactiver plus tard) */
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",

      /* Style/contraintes non essentielles */
      "no-console": "off",
      "complexity": "off",
      "max-depth": "off",
      "max-lines": "off",
      "import/order": "off",
      "import/no-unresolved": "off",
      "n/no-missing-import": "off",
      "n/no-missing-require": "off"
}
}