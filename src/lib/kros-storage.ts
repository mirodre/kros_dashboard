/**
 * Zvyšky po ére, keď prepojenia s KROS žili v prehliadači.
 *
 * Od fázy 2 sú v databáze a viažu sa na firmu, nie na zariadenie. Tento modul už nič
 * nezapisuje — vie len prečítať staré hodnoty (aby sa dali raz nahrať na server) a zmazať
 * ich. Zmazanie je bezpečnostný krok, nie upratovanie: token nemá ležať v `localStorage`
 * ani o deň dlhšie, než musí.
 */
const CONNECTIONS_KEY = "kros_dashboard_connections";
const PENDING_STATE_KEY = "kros_dashboard_pending_state";

/** Starý tvar záznamu — s tokenom, ktorý dnes prehliadač už nikdy nedostane. */
export type LegacyKrosConnection = {
  companyId: number;
  companyName: string;
  token: string;
  webhookSecret?: string;
};

export function readLegacyConnections(): LegacyKrosConnection[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(CONNECTIONS_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.filter((entry): entry is LegacyKrosConnection => {
      const connection = entry as Partial<LegacyKrosConnection>;
      return (
        typeof connection?.companyId === "number" &&
        typeof connection?.companyName === "string" &&
        connection.companyName.length > 0 &&
        typeof connection?.token === "string" &&
        connection.token.length > 0
      );
    });
  } catch {
    return [];
  }
}

/** Zmaže staré prepojenia aj rozpracovaný `state`. Volá sa po úspešnom nahratí na server. */
export function clearLegacyConnections(): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.removeItem(CONNECTIONS_KEY);
    localStorage.removeItem(PENDING_STATE_KEY);
  } catch {
    // Zakázané úložisko: nahranie na server prebehlo, tokeny v prehliadači sú len kópia.
  }
}
