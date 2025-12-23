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
  "plugins": [
    "@typescript-eslint",
    "import",
    "promise",
    "n"
  ],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/strict",
    "plugin:@typescript-eslint/recommended-type-checked",
    "plugin:import/recommended",
    "plugin:import/typescript",
    "plugin:promise/recommended",
    "plugin:n/recommended"
  ],
  "rules": {
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/explicit-member-accessibility": ["error", { "accessibility": "no-public" }],
    "@typescript-eslint/consistent-type-imports": "error",
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
    "@typescript-eslint/no-floating-promises": ["error", { "ignoreVoid": false }],
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-return": "error",
    "eqeqeq": ["error", "always"],
    "curly": ["error", "all"],
    "no-console": "warn",
    "no-var": "error",
    "prefer-const": "error",
    "complexity": ["warn", 10],
    "max-depth": ["warn", 3],
    "max-lines": ["warn", 300],
    "import/order": [
      "error",
      {
        "groups": ["builtin", "external", "internal", "parent", "sibling", "index"],
        "newlines-between": "always",
        "alphabetize": { "order": "asc", "caseInsensitive": true }
      }
    ],
    "import/no-unresolved": "error",
    "promise/no-return-wrap": "error",
    "n/no-missing-import": "error",
    "n/no-missing-require": "error",
    "n/no-extraneous-import": "error",
    "n/no-extraneous-require": "error"
  }
}
