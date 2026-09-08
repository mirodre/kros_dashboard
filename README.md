# KROS Dashboard (Fáza A)

Mobilný dashboard pre KROS (tržby, štítky, firmy, cashflow). Prístup k dátam je viazaný na prepojenie s KROS (výmena OAuth tokenov) — pozri [Live napojenie na KROS](#live-napojenie-na-kros-fáza-b). Prepojenie aj filtre patria **firme**, nie zariadeniu: kto sa prihlási, vidí to isté na telefóne aj na notebooku.

Moduly:

| Cesta | Modul | Čo ukazuje |
|---|---|---|
| `/` | **Domov** | Zisk firmy, pohľadávky a záväzky, peniaze na účtoch, odhad DPH, zisk podľa štítkov a firiem |
| `/prijmy` | Príjmy | Vývoj tržieb, tržby podľa štítkov a podľa firiem |
| `/expenses` | Výdavky | Štruktúra výdavkov, dodávatelia, splatnosti |
| `/cashflow` | Financie | Účty, pohyby, cashflow |

Ďalej: Revolut-like swipe KPI karty, filter granularít (týždeň / mesiac / rok), [inštalácia na plochu](#inštalácia-na-plochu-pwa).

**Domov je výcuc z ostatných modulov, nie ďalší zdroj dát.** Skladá čísla, ktoré inde
nie sú — zisk vzniká až spojením príjmov a výdavkov — ale nesťahuje nič navyše:
pozri [Zdieľané sťahovanie](#zdieľané-sťahovanie).

## Zdieľané sťahovanie

Sťahovanie dát z KROS API žije v `src/lib/sync/`: tri „enginy" (faktúry, výdavky,
platby) a jeden orchestrátor nad nimi. Modul si vypýta jeden engine, Domov všetky tri.

Zdrojom pravdy o tom, čo je už stiahnuté, je `syncMeta` v IndexedDB — **nie stav
stránky**. Keď Domov dotiahne august faktúr, plánovač faktúr na `/prijmy` ten mesiac
už nezaradí a stránka ho len prečíta z cache. Platí to aj opačne a aj medzi kartami
prehliadača, takže rovnaké dáta sa nikdy nesťahujú dvakrát.

Engine vie len naplánovať kroky a jeden vykonať; ukazovateľ priebehu, prerušenie
a značku posledného syncu vlastní orchestrátor. Preto môžu tri domény bežať za sebou
pod jedným progress barom bez toho, aby si ho navzájom prepisovali.

Plánovače (`plan()`) sú exportované samostatne a majú testy — je to jediné miesto,
ktoré rozhoduje, či sa niečo stiahne druhýkrát.

## Prihlásenie

Appka nemá vlastné prihlasovacie obrazovky ani vlastných používateľov — identitu vlastní
`authentication_service` (`https://login.krosdoplnky.sk`). Appka je jeho OAuth2 klient
(authorization code + PKCE, Auth.js v5); prístup na `https://prehlady.krosdoplnky.sk` bez
platnej session tam automaticky presmeruje.

Registrácia klienta v službe, premenné prostredia potrebné na oboch stranách a overovací
checklist po nasadení: [docs/SSO-prechod.md](docs/SSO-prechod.md).

## Premenné prostredia

Všetky premenné sú voliteľné (majú rozumné defaulty v kóde). Ak ich chceš prepísať, skopíruj `.env.example` → `.env`.

| Premenná | Povinné | Popis |
|----------|---------|--------|
| `DATABASE_URL` | **áno** | Postgres pre nastavenia a prepojenia s KROS. Bez nej sa prepojenia nedajú načítať a dashboard nedostane dáta. |
| `KROS_TOKEN_KEY` | **áno** | 32 bajtov v base64 (`openssl rand -base64 32`) na šifrovanie KROS tokenov v databáze. |
| `KROS_API_BASE_URL` | nie | Default `https://api-economy.kros.sk` |
| `NEXT_PUBLIC_KROS_CONSENT_BASE_URL` | nie | Default `https://firma.kros.sk/integration-consent` |

## Spustenie (vývoj)

1. Nainštaluj Node.js 20+.
2. V koreni projektu spusti:

```bash
npm install
npm run dev
```

3. Otvor `http://localhost:3000` — bez platnej session ťa middleware presmeruje na prihlásenie cez `authentication_service` (pozri [Prihlásenie](#prihlásenie)).

## Nasadenie na server

**Coolify / Nixpacks:** projekt obsahuje `.nvmrc` a `nixpacks.toml` (Node 20). Bez toho build zlyhá na Node 18.

Po `git pull` na serveri (Node.js 20+):

```bash
cp .env.example .env   # len pri prvom nasadení — potom .env uprav a necommituj
npm install
npm run build
npm run start
```

Po reštarte otvor URL aplikácie — prihlásenie vyžaduje `authentication_service` (pozri [Prihlásenie](#prihlásenie)), prístup k dátam po prihlásení ešte vyžaduje prepojenie s KROS.

Aktualizácia z repozitára:

```bash
git pull
npm install
npm run build
# reštart procesu (pm2, systemd, …)
```

## Inštalácia na plochu (PWA)

Prehľad sa dá pridať medzi ikony telefónu a otvoriť ako appku — na celú obrazovku, bez
adresného riadka. Pozvánku appka kreslí sama, nie prehliadač:

1. **Lišta nad menu** (`src/components/install-invite.tsx`) — objaví sa 9 sekúnd po
   otvorení appky. Nikto neinštaluje appku, ktorú ešte nevidel.
2. **Spodný dialóg** (`src/components/install-sheet.tsx`) — ukáže, ako bude ikona na
   ploche vyzerať a čo z inštalácie človek má. Na iOS namiesto toho tri kroky cez menu
   Zdieľať, pretože Apple `beforeinstallprompt` neimplementuje.
3. **Systémový dialóg Chromu** — až na kliknutie „Nainštalovať". Prehliadačový pásik je
   potlačený (`event.preventDefault()` v `src/lib/use-install-prompt.ts`), takže si
   rozhodnutie nevypýta skôr, ako appka povie, o čom je.

Zavretie pozvánky sa pamätá v `localStorage` **tohto zariadenia** (nie v serverových
nastaveniach — appku na telefóne môžeš mať a na notebooku nie). Prvé zavretie ju stichne
na 3 dni, druhé na 3 týždne, potom sa sama neukáže viac; inštalácia zostáva dostupná v
**Nastavenia → Appka na plochu**. Pravidlá sú v `src/lib/install-prompt.ts` a majú testy.

### Servisný worker

`public/sw.js` je tu kvôli inštalácii: **Chromium appku neponúkne nainštalovať, kým na
stránke nebeží servisný worker s `fetch` obsluhou.** Zároveň drží offline stránku
(`public/offline.html`), aby appka spustená z plochy bez signálu nekončila chybovou
stránkou prehliadača.

Kešuje len hashované assety buildu (`/_next/static/*`), ikony a offline stránku.
`/api/*` ani HTML modulov sa nedotkne — sú to dáta firmy za prihlásením a cache
prehliadača prežije odhlásenie. Stráži to `src/lib/service-worker.test.ts`.

Worker sa registruje **len v produkčnom builde** (`src/components/service-worker-boot.tsx`):
`next dev` servíruje chunky bez hashu v URL, takže cache-first by pri vývoji podávalo
staré. Inštaláciu preto testuj cez `npm run build && npm start` (localhost sa počíta ako
bezpečný origin) alebo na nasadenej appke.

Po zmene `public/sw.js` treba zvýšiť `VERSION` v jeho hlavičke, inak si prehliadače
ponechajú staré cache.

### Ikony

| Súbor | Na čo |
|---|---|
| `public/icon.svg` | favicon a ikona v UI appky |
| `public/favicon.ico` | prehliadače bez SVG faviconu |
| `public/apple-icon.png` | ikona na ploche iOS (SVG tam iOS ignoruje) |
| `public/icon-192.png`, `public/icon-512.png` | inštalácia na Androide |
| `public/icon-maskable.svg` + `icon-maskable-192/512.png` | adaptívna ikona Androidu |

Maskovateľná ikona je vlastná kresba, nie zväčšený favicon: launcher si z nej vystrihne
svoj tvar (kruh, squircle), takže pozadie ide od okraja po okraj a kresba sa musí zmestiť
do bezpečného kruhu s priemerom 80 % plátna. Bez nej Android ikonu nezmaskuje, ale zmenší
a podloží bielym kolieskom.

PNG-ká z nej vznikajú rasterizáciou SVG — čímkoľvek, čo dodrží veľkosť a zachová
priehľadnosť (napr. `rsvg-convert -w 512 -h 512 public/icon-maskable.svg -o public/icon-maskable-512.png`).
Po zmene `icon-maskable.svg` treba oba PNG-ká vygenerovať znova.

## Zapamätané nastavenia (filtre)

Filtre firiem a štítkov sa ukladajú **na firmu** (tenant zo `authentication_service`), takže
človeka nasledujú na iné zariadenie a dajú sa zdieľať s kolegami. To isté platí pre prepojenia
s KROS (pozri [Live napojenie na KROS](#live-napojenie-na-kros-fáza-b)). Zbalenie panelov
a granularita sú **osobné** — zdieľať ich by znamenalo prestavovať kolegovi obrazovku.

- Bežná zmena filtra sa ukladá **len pre mňa**. Firemné predvolené nastaví výslovná akcia
  v `/settings` → **Firemné filtre → Nastaviť pre celú firmu** (smie ju urobiť ktokoľvek
  v tej firme; kto to bol naposledy, panel ukazuje).
- **Vrátiť sa na firemné filtre** zmaže moje osobné prepísanie.
- `localStorage` zostáva ako cache filtrov, takže prvé vykreslenie je okamžité a appka
  funguje aj offline. Bez `DATABASE_URL` sa nastavenia neukladajú na server a **prepojenia
  s KROS nefungujú vôbec**, lebo tokeny sa nemajú kde načítať.
- **Migrácie schémy sa aplikujú pri štarte servera** (`src/instrumentation.ts`), samostatný
  krok pri nasadení netreba — v logu sa objaví `Migrácie aplikované: …`. Zámerne tu nie je
  `npm run migrate`: samostatný TypeScript runner by si vyžiadal ďalšiu závislosť, ktorú by
  používal jeden príkaz.
- Existujúce filtre z prehliadača sa pri prvom otvorení nahrajú **do osobnej úrovne**, nie do
  firemnej — inak by prvý človek po nasadení prestavil dashboard celej firme.
- Tlačidlo **Vymazať cache dát** maže len doklady z KROS API a stav synchronizácie; filtre
  ostávajú (stráži to test v `src/lib/cache-clear.test.ts`).

## Bezpečnosť (verejné nasadenie)

- Prístup do appky vyžaduje prihlásenie cez `authentication_service` (pozri [Prihlásenie](#prihlásenie)); appka nemá vlastné prihlasovacie obrazovky. Nad tým, po prihlásení, je prístup k dátam ešte viazaný na prepojenie s KROS.
- **KROS tokeny sú v databáze, šifrované** (AES-256-GCM, kľúč z `KROS_TOKEN_KEY`) a do prehliadača sa nikdy nevracajú — klient posiela len `companyId`. Únik databázy je tým pádom únikom prístupu k účtovným dátam: zálohy patria šifrovať a prístup k DB držať úzky.
- **Členstvo vo firme v `authentication_service` je rozhodnutie o prístupe k účtovným dátam.** Kto je vo firme, vidí všetky jej prepojené firmy — a spravuje sa to v inej appke, než kde sa to prejaví.
- KROS OAuth callback vyžaduje platný server-side `state` (CSRF ochrana).
- Po aktualizácii nasaď `next@16.2.6+` kvôli opraveným CVE v starších verziách Next.js.
- **Cloudflare loader** (ochrana pred botmi pred appkou): návod [docs/cloudflare-loader.md](docs/cloudflare-loader.md).

## Poznámka

Aktuálna verzia má fallback mock dáta a zároveň podporuje live napojenie na KROS API.

## Live napojenie na KROS (Fáza B)

Backend route handlers:
- `POST /api/kros/poll`
- `POST /api/kros/invoices`

Flow:
1. Klikni `Prepojiť s KROS`.
2. V KROS udeľ súhlas pre firmy.
3. Po schválení ťa KROS presmeruje späť do aplikácie (cross-site POST na `/kros/callback`).
4. Server si podľa jednorazového `state` zistí, ktorej firme prepojenie patrí, uloží tokeny **šifrované do databázy** a dashboard sa prepne na live dáta — na všetkých zariadeniach a pre všetkých vo firme.

Odpojenie firmy v `/settings` platí pre celú firmu a späť sa dá len novým súhlasom v KROS.
KROS API na odvolanie súhlasu z appky nemá, takže odpojenie zmaže token u nás; ak treba
súhlas zrušiť aj na strane KROS, robí sa to v KROS.

Prepojenia, ktoré komukoľvek ostali v `localStorage` z predchádzajúcich verzií, appka pri
prvom otvorení nahrá na server a z prehliadača zmaže — nikto sa nemusí prepájať znova.
