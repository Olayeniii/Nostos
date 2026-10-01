import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".build/**",
      "coverage/**",
      "node_modules/**",
      "private-evidence/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      "no-console": "error",
    },
  },
  {
    files: [
      "scripts/quality/*.mjs",
      "scripts/shielded-spike/**/*.ts",
      "scripts/payment-intake/**/*.ts",
      "scripts/refund-core/**/*.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
);
