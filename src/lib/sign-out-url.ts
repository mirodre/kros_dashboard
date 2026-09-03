import { serviceUrl } from "@/lib/auth-service";

/**
 * Odhlásenie musí zrušiť aj session v službe, inak by ďalšie kliknutie na „Prihlásiť sa"
 * ticho prihlásilo toho istého človeka späť.
 *
 * `?app=` je tu podstatné: povie službe, z ktorej appky človek odchádza, takže opätovné
 * prihlásenie ho vráti sem a nie na profil služby. Kľúč musí existovať v allowliste
 * `AUTH_RETURN_APPS` na strane služby, inak sa vyhodnotí ako neznámy a nič sa nestane.
 *
 * Prázdny alebo len biely reťazec nie je nakonfigurovaný kľúč — je to napr. odkomentovaný
 * riadok v `.env.example` bez hodnoty, alebo šablóna nasadenia, ktorá nič nedosadila. Bez
 * `.trim() || "prehlady"` by sa poslalo `app=` bez hodnoty, čo služba vyhodnotí rovnako ako
 * neznámy kľúč — a nikto by si to nevšimol, kým sa niekomu po prihlásení nezjaví profil
 * služby namiesto appky.
 */
export function serviceSignOutUrl(): string {
  const app = (process.env.AUTH_SERVICE_APP_KEY ?? "").trim() || "prehlady";

  return `${serviceUrl()}/logout?app=${encodeURIComponent(app)}`;
}
