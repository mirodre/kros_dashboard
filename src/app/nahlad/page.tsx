import HomePage from "../page";

/**
 * DOČASNÉ: náhľad Domova pre vývoj UI.
 *
 * Lokálne sa nedá prihlásiť (SSO klient nie je registrovaný pre `localhost`) a bez
 * databázy neexistujú prepojenia s KROS, takže Domov sa tu vykreslí v demo režime —
 * presne to, čo treba na kontrolu rozloženia, grafu a menu.
 *
 * Middleware túto cestu pustí len mimo produkcie (`src/middleware.ts`). Zmazať aj
 * s tou výnimkou po dokončení modulu Domov.
 */
export default function NahladPage() {
  return <HomePage />;
}
