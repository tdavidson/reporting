import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

// `next lint` ran with no config file here, which meant `core-web-vitals` and nothing else. This is
// the same rule set under the ESLint CLI, which Next 16 requires. The codemod also offered
// `eslint-config-next/typescript`; it is deliberately not included, because it turns
// `no-explicit-any` into an error across ~2,800 pre-existing sites — a decision about the codebase's
// style, not part of a framework upgrade. Add it back when that decision is made.
const eslintConfig = [
  ...nextCoreWebVitals,
  {
    // Rules eslint-config-next 16 newly raises to ERROR that the Next 14 build (which ran lint)
    // passed with. Kept visible as warnings rather than silenced: the React Compiler family
    // (set-state-in-effect, purity, static-components, immutability, use-memo) is a real signal
    // about 130-odd effects worth revisiting, but revisiting them is its own change, not a
    // framework upgrade's. Promote any of these back to "error" when that work is done.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/static-components": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/use-memo": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Worktrees Claude Code creates under .claude/ are separate checkouts, not source.
      ".claude/**",
      // Vendored tarballs and generated output.
      "vendor/**",
      "supabase/functions/**",
    ],
  },
];

export default eslintConfig;
