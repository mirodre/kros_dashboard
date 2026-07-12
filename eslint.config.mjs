import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    rules: {
      // React Compiler pravidlá z react-hooks v6: existujúce data-loading effecty
      // (hydratácia z localStorage/sessionStorage) ich zatiaľ nespĺňajú.
      // Vypnuté, kým sa effecty nerefaktorujú.
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/immutability": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
      ]
    }
  }
];

export default config;
