import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";

// Ratchet policy: rules that are already clean are `error` so they can never
// regress. Rules with a pre-existing backlog start as `warn` so `npm run lint`
// exits 0 today and CI can gate on `--max-warnings` being driven down over time.
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      // pm2's config is CommonJS by design — the TS require-imports rule is a
      // false positive on it, and it was the one `error` failing verify.
      "ecosystem.config.cjs",
      "playwright-report/**",
      "**/.claude/**",
      "**/.claire/**",
      "docs/**",
      "supabase/migrations/**",
      // generated — see CLAUDE.md "Design tokens" and Supabase type generation
      "src/types/db.ts",
      "src/styles/tokens.ts",
      // design-sync's generated output — untracked (same names as the
      // .gitignore block) but `eslint .` was still linting it: 927 errors
      // that failed `npm run verify` on any machine that had run design-sync.
      "types/**",
      ".ds-sync/**",
      "ds-bundle/**",
      ".design-sync/**",
      "apps-script/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    plugins: { "unused-imports": unusedImports },
    rules: {
      // The single highest-value pair for an agent-written React codebase:
      // dead imports accumulate silently, and `any` hides real breakage.
      "unused-imports/no-unused-imports": "error",
      "@typescript-eslint/no-unused-vars": "off",
      "unused-imports/no-unused-vars": [
        "warn",
        { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      // A directive that suppresses nothing is evidence of blind suppression;
      // 14 of the repo's type errors were exactly this.
      "@typescript-eslint/ban-ts-comment": [
        "warn",
        { "ts-expect-error": "allow-with-description", "ts-ignore": true },
      ],
      // `cond ? a() : b()` as a statement is idiomatic here; the real problem
      // with those sites is duplication, handled separately.
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],
      eqeqeq: ["error", "smart"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },

  // ---- Browser app ----
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { "react-hooks": reactHooks, "react-refresh": reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Stale-closure bugs are the #1 defect class in generated React code.
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // ---- Project conventions (CLAUDE.md) ----
      // One Supabase client, one money formatter. Both are cheap to re-implement
      // inline, which is exactly why they get duplicated.
      "no-restricted-syntax": [
        "warn",
        {
          selector: "NewExpression[callee.object.name='Intl'][callee.property.name='NumberFormat']",
          message:
            "Money/number formatting belongs in src/lib/format.ts (ZAR, int cents). Import a formatter instead of inlining Intl.NumberFormat.",
        },
        {
          selector: "CallExpression[callee.name='createClient']",
          message: "Import the shared client from @/lib/supabase instead of constructing another one.",
        },
      ],
    },
  },
  {
    // The shared client and formatter are where those two things are allowed to live.
    files: ["src/lib/supabase.ts", "src/lib/format.ts"],
    rules: { "no-restricted-syntax": "off" },
  },

  // ---- Tests ----
  {
    files: ["**/*.test.{ts,tsx}", "src/test/**", "e2e/**"],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-restricted-syntax": "off",
      "no-console": "off",
    },
  },

  // ---- Deno edge functions ----
  {
    files: ["supabase/functions/**/*.ts"],
    languageOptions: { globals: { ...globals.deno, ...globals.node } },
    rules: {
      // Deno resolves npm:/jsr:/https: specifiers the TS resolver here does not.
      "import/no-unresolved": "off",
      "no-restricted-syntax": "off",
      "no-console": "off",
    },
  },

  // ---- Node-side tooling ----
  {
    files: ["scripts/**/*.ts", "mcp-server/src/**/*.ts", "*.config.{ts,js,cjs,mjs}"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off", "no-restricted-syntax": "off" },
  },
);
