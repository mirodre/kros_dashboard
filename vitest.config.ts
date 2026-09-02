import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Node, nie jsdom: testujeme fetch klienta, čisté funkcie a middleware logiku,
    // nie komponenty. Keby raz pribudli testy komponentov, pridá sa vtedy aj jsdom.
    environment: "node",
    include: ["src/**/*.test.ts"]
  },
  resolve: {
    // Rovnaký alias ako tsconfig.json `paths`. Ručne, aby nepribudla ďalšia závislosť.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) }
  }
});
