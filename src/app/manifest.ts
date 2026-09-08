import type { MetadataRoute } from "next";

/**
 * Manifest je to jediné, čím appka ovplyvní vzhľad SYSTÉMOVEJ časti inštalácie —
 * dialógu Chromu a ikony na ploche. Vlastnú pozvánku kreslí
 * `src/components/install-sheet.tsx`, ale ten dialóg za ňou už appka nekreslí, len ho
 * zásobuje údajmi odtiaľto. Preto tu nie je nič „navyše":
 *
 *   - `id` — trvalá identita appky. Bez neho ju prehliadač identifikuje `start_url`,
 *     takže neskorší presun štartu (napr. na `/?domov`) by vyzeral ako druhá, cudzia
 *     appka a človeku by na ploche skončili dve ikony.
 *   - `description` a `categories` — dialóg Chromu popis zobrazuje. Bez neho ukáže
 *     holé „Nainštalovať appku?" a názov domény.
 *   - maskovateľné ikony — pozri komentár nižšie.
 *   - `shortcuts` — dlhé podržanie ikony na ploche otvorí moduly priamo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "KROS Prehľad",
    short_name: "Prehľad",
    description:
      "Prehľad tržieb, výdavkov, pohľadávok a peňazí na účtoch z KROSu — na telefóne, na jednu obrazovku.",
    start_url: "/",
    // `scope` drží appku vo vlastnom okne: čokoľvek mimo `/` (prihlásenie do KROSu,
    // súhlas na firma.kros.sk) otvorí systémový prehliadač, čo je správne — cudzia
    // prihlasovacia obrazovka nemá čo pôsobiť ako súčasť appky.
    scope: "/",
    display: "standalone",
    // Keby prehliadač `standalone` nezvládol, `minimal-ui` je stále bližšie k appke ako
    // plná karta prehliadača s adresným riadkom.
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait",
    background_color: "#111420",
    theme_color: "#111420",
    lang: "sk",
    dir: "ltr",
    categories: ["business", "finance", "productivity"],
    // Android inštaláciu robí z PNG — SVG tu bolo deklarované s `sizes: "192x192"`,
    // čo je pre vektor nezmysel a niektoré launchery ho preto preskočili. PNG-ká
    // vznikli z `public/icon.svg`, takže ikona zostáva jedna, len v troch formátoch.
    //
    // `purpose` je rozdelené zámerne. `any` = ikona sa použije, ako je (dlaždica s
    // vlastným zaoblením). `maskable` = launcher si z nej vystrihne svoj tvar, a to
    // znesie len kresba s bezpečnou zónou — preto vlastný súbor
    // (`public/icon-maskable.svg` a PNG z neho). Bez maskovateľnej verzie Android
    // ikonu nezmaskuje, ale zmenší a podloží bielym kolieskom: tmavá dlaždica prehľadu
    // potom na ploche vyzerá ako nálepka na tanieriku.
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable"
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      }
    ],
    shortcuts: [
      {
        name: "Príjmy",
        short_name: "Príjmy",
        url: "/prijmy",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Výdavky",
        short_name: "Výdavky",
        url: "/expenses",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }]
      },
      {
        name: "Financie",
        short_name: "Financie",
        url: "/cashflow",
        icons: [{ src: "/icon-192.png", sizes: "192x192", type: "image/png" }]
      }
    ],
    // Appka v žiadnom obchode nie je a inštaluje sa priamo z webu. Bez tohto poľa by
    // niektoré prehliadače hľadali „príbuznú" nativnú appku, ktorá neexistuje.
    prefer_related_applications: false
  };
}
