/**
 * Zoznam VEREJNÝCH ciest, nie chránených — a to je celý zmysel tohto modulu.
 *
 * Kým sa vymenúvali chránené cesty, stačilo pridať novú route a zabudnúť ju doplniť; presne
 * tak visel `GET /api/kros/logs` verejne a vydával názvy firiem komukoľvek. Obrátený zoznam
 * znamená, že nová route je chránená v deň, kedy vznikne.
 *
 * Pridať sem niečo je vedomé rozhodnutie. Health endpoint appka dnes nemá; keby pribudol,
 * patrí sem — ale nech to niekto napíše naschvál, nie omylom.
 */
const PUBLIC_PREFIXES = [
  "/api/auth/", // handlery Auth.js: signin, callback, session, csrf
  "/_next/" // build assety Next.js
] as const;

/**
 * Presné cesty, nie predpony — na rozdiel od `PUBLIC_PREFIXES` sa musia zhodovať celé,
 * inak by sa verejným stal aj čokoľvek pod nimi.
 *
 * `/kros/callback` je jediný záznam a je tu zámerne: KROS integration-consent služba
 * (`firma.kros.sk`) sem posiela cross-site form POST (`src/lib/kros-connect.ts`,
 * `redirect_url`). Session cookie Auth.js má `sameSite: "lax"`, a Lax cookie sa pri
 * cross-site POSTe neposiela — aj prihlásený používateľ by teda prišiel bez session,
 * middleware by ho presmeroval na `/api/auth/signin` a POST telo (zoznam firiem) by sa
 * stratilo. Skutočná autorizácia tejto route nie je session, ale jednorazový `state`,
 * ktorý handler overuje cez `consumeOAuthState()` (`src/app/kros/callback/route.ts`) —
 * ten istý token, čo appka sama vydala cez `POST /api/kros/oauth-state`, ktoré je samo
 * za prihlásením.
 */
const PUBLIC_EXACT = new Set(["/kros/callback"]);

/**
 * Statické súbory z `public/` — majú príponu a Next ich servíruje z koreňa.
 * Pod `/api/` sa nachádzajú route handlery, nie súbory; ak má handler príponu,
 * (napr. `/api/kros/export.xml`), klasifikovať ho podľa prípony by znova ohrozilo
 * `/api/kros/logs` — statický súbor, ktorý nikdy nebol.
 */
const PUBLIC_FILE = /\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml|webmanifest|woff2?)$/i;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) {
    return true;
  }

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  // Route handlery pod /api/ su dynamicke, nie staticke subory.
  if (pathname.startsWith("/api/")) {
    return false;
  }

  return PUBLIC_FILE.test(pathname);
}
