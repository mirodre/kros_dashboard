import { serviceUrl } from "@/lib/auth-service";

/**
 * Odhlásenie musí zrušiť aj session v službe, inak by ďalšie kliknutie na „Prihlásiť sa"
 * ticho prihlásilo toho istého človeka späť.
 *
 * `?app=` je tu podstatné: povie službe, z ktorej appky človek odchádza, takže opätovné
 * prihlásenie ho vráti sem a nie na profil služby. Kľúč musí existovať v allowliste
 * `AUTH_RETURN_APPS` na strane služby, inak sa vyhodnotí ako neznámy a nič sa nestane.
 */
export function serviceSignOutUrl(): string {
  const app = process.env.AUTH_SERVICE_APP_KEY ?? "prehlady";

  return `${serviceUrl()}/logout?app=${encodeURIComponent(app)}`;
}
