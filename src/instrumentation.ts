/**
 * Migrácie pri štarte servera. Deploy je podľa README `npm run build && npm run start`;
 * samostatný migračný krok by musel niekto pridať do Dokploy a raz by sa naň zabudlo —
 * a chýbajúca tabuľka sa prejaví až prvým 500 v prevádzke.
 *
 * `register()` volá Next raz na inštanciu servera, ešte pred obsluhou requestov.
 */
export async function register(): Promise<void> {
  // Middleware beží v edge sandboxe, kde `pg` neexistuje. Bez tejto podmienky by import
  // spadol pri každom štarte edge runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const [{ getPool }, { runMigrations }] = await Promise.all([
    import("@/lib/db/pool"),
    import("@/lib/db/migrate")
  ]);

  const pool = getPool();
  if (!pool) return;

  try {
    const performed = await runMigrations(pool);
    if (performed.length > 0) {
      console.info(`Migrácie aplikované: ${performed.join(", ")}`);
    }
  } catch (error) {
    // Appka musí naštartovať aj s nepojazdnou databázou — nastavenia sú doplnok. Hlásenie
    // je hlasné, aby sa to nedalo prehliadnuť v logu.
    console.error("Migrácie zlyhali, nastavenia sa nebudú ukladať na server:", error);
  }
}
