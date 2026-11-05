import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/out/**",
      "**/dist-types/**",
      "reference/**",
      "tests/fixtures/work/**",
      ".tmp-eagle/**",
      "**/.tmp-*/**",
      // vendored wasm/emscripten runtime for KTX2 - third-party bundle
      "apps/desktop/src/renderer/public/basis/**",
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
      // AGENTS.md: no `any` without a comment explaining why. Zero uses
      // today, so the gate is an error - a warning is never read in CI.
      "@typescript-eslint/no-explicit-any": "error",
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
