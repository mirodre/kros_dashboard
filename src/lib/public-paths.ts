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

const PUBLIC_EXACT = new Set(["/favicon.ico", "/manifest.webmanifest"]);

/** Statické súbory z `public/` — majú príponu a Next ich servíruje z koreňa. */
const PUBLIC_FILE = /\.(?:png|jpg|jpeg|svg|webp|ico|txt|xml|webmanifest|woff2?)$/i;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) {
    return true;
  }

  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }

  return PUBLIC_FILE.test(pathname);
}
