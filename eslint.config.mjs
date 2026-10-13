import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/dist-types/**",
      "reference/**",
      "tests/fixtures/work/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // box-core purity guard: platform imports are banned inside box-core
      // (enforced structurally by the no-platform-imports rule below).
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports" },
      ],
    },
  },
  {
    files: ["packages/box-core/src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*"],
              message: "box-core is platform-agnostic: inject via IVault.",
            },
            {
              group: ["electron"],
              message: "box-core must never import electron.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/box-ui/src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
);
