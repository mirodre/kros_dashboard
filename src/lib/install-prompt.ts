/**
 * Rozhodovanie o pozvánke „pridaj si prehľad na plochu".
 *
 * Prečo vlastná pozvánka a nie tá prehliadačová: Chrome na Androide ponúka inštaláciu
 * sám, ale len ako sivý pásik nad obsahom bez jediného slova o tom, čo z toho človek má.
 * Safari na iOS neponúka nič — kto nevie o ceste „Zdieľať → Pridať na plochu", appku si
 * na plochu nedá vôbec. Preto appka `beforeinstallprompt` zachytí, prehliadačový pásik
 * potlačí a povie to po svojom (`src/components/install-invite.tsx`); systémový dialóg
 * sa vyvolá až kliknutím na „Nainštalovať", teda vtedy, keď už človek vie, na čo kýva.
 *
 * Tento modul je zámerne bez Reactu aj bez `window`: sú to čisté funkcie nad tým, čo
 * prehliadač povedal. Rozhodnutie „ukázať / neukázať" je totiž jediné miesto, kde sa
 * z milej pozvánky vie stať otravný pásik pri každom otvorení — a jediné, na čo sa dá
 * napísať test.
 */

/** Ako sa na TOMTO zariadení dá appka nainštalovať. */
export type InstallMethod =
  /** Prehliadač dal `beforeinstallprompt` — inštaláciu vyvolá appka sama. */
  | "browser-prompt"
  /** iOS: API neexistuje, jediná cesta je ručne cez menu Zdieľať. */
  | "ios-share"
  /** Už nainštalované, alebo to prehliadač nevie — nie je čo ponúkať. */
  | "unavailable";

/** Ako dopadol systémový dialóg inštalácie. */
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/** Čo si appka pamätá o zavretých pozvánkach. Žije v `localStorage`, pozri `INSTALL_HINT_STORAGE_KEY`. */
export type InstallHint = {
  /** Kedy človek pozvánku naposledy zavrel (epoch ms). */
  dismissedAt: number;
  /** Koľkokrát ju už zavrel. Každé ďalšie zavretie predlžuje ticho. */
  dismissals: number;
};

/**
 * Kľúč v `localStorage`, nie v nastaveniach na serveri — a to je vedomé rozhodnutie.
 * Inštalácia patrí ZARIADENIU: kto si appku pridal na plochu telefónu, na notebooku ju
 * ešte nemá a pozvánku tam dostať má. Serverové nastavenie (`preferences/registry.ts`)
 * by mu ju stichlo všade naraz.
 *
 * Kľúč zámerne NIE je v `CLEARED_LOCAL_KEYS` (`src/lib/cache-clear.ts`): „Vymazať cache
 * dát" má zmazať doklady, nie prehovoriť človeka, ktorý pozvánku odmietol.
 */
export const INSTALL_HINT_STORAGE_KEY = "kros_dashboard_install_hint";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Ako dlho je po zavretí ticho — podľa toho, koľkýkrát to bolo.
 *
 * Po vyčerpaní zoznamu sa pozvánka sama neukáže NIKDY viac: dve odmietnutia sú
 * odpoveď, nie prehliadnutie. Inštalovať sa dá aj potom, len si to už človek musí
 * vyvolať sám v Nastaveniach (`src/components/install-app-card.tsx`) — to je ten
 * rozdiel medzi ponukou a otravou.
 */
export const INSTALL_SNOOZE_STEPS_MS = [3 * DAY_MS, 21 * DAY_MS] as const;

/**
 * Ako dlho po otvorení appky sa pozvánka drží pod pokrievkou.
 *
 * Nikto neinštaluje appku, ktorú ešte nevidel. Prvé sekundy patria dátam — pozvánka
 * príde, až keď človek zostal.
 */
export const INSTALL_INVITE_DELAY_MS = 9000;

/**
 * iOS a iPadOS. iPadOS 13+ sa v `userAgent` hlási ako „Macintosh", takže sám o sebe
 * nestačí — Mac od iPadu odlíši až dotykové ovládanie (`maxTouchPoints`). Bez toho by
 * appka na desktopovom Macu ukazovala inštrukcie s tlačidlom Zdieľať, ktoré tam nie je.
 */
export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true;
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

export function resolveInstallMethod({
  hasPromptEvent,
  isInstalled,
  userAgent,
  maxTouchPoints = 0
}: {
  /** Prehliadač už poslal `beforeinstallprompt` a appka ho drží. */
  hasPromptEvent: boolean;
  /** Appka beží z plochy (`display-mode: standalone`, na iOS `navigator.standalone`). */
  isInstalled: boolean;
  userAgent: string;
  maxTouchPoints?: number;
}): InstallMethod {
  // Nainštalované vyhráva nad všetkým ostatným. Chrome vie `beforeinstallprompt`
  // poslať aj do už nainštalovanej appky (iný profil, iný prehliadač na tom istom
  // zariadení) a ponúkať inštaláciu tomu, kto appku práve má otvorenú z plochy,
  // je nezmysel.
  if (isInstalled) return "unavailable";
  if (hasPromptEvent) return "browser-prompt";
  // iOS je posledný naschvál: keď Safari/Chrome na iOS raz dostane `beforeinstallprompt`
  // (Apple ho zatiaľ neimplementuje), automatická cesta je aj tam lepšia ako inštrukcie.
  if (isIosDevice(userAgent, maxTouchPoints)) return "ios-share";
  return "unavailable";
}

/** Prečíta pamäť o zavretých pozvánkach. Čokoľvek pokazené sa berie ako „nič" — pozvánka nie je hodná chyby. */
export function readInstallHint(storage: Pick<Storage, "getItem">): InstallHint | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(INSTALL_HINT_STORAGE_KEY);
  } catch {
    // Privátny režim so zakázaným úložiskom hádže už pri čítaní.
    return null;
  }
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { dismissedAt, dismissals } = parsed as Record<string, unknown>;
    if (typeof dismissedAt !== "number" || !Number.isFinite(dismissedAt)) return null;
    if (typeof dismissals !== "number" || !Number.isFinite(dismissals) || dismissals < 1) return null;
    return { dismissedAt, dismissals: Math.floor(dismissals) };
  } catch {
    return null;
  }
}

/** Ďalší stav pamäte po zavretí pozvánky. */
export function nextInstallHint(previous: InstallHint | null, now: number): InstallHint {
  return { dismissedAt: now, dismissals: (previous?.dismissals ?? 0) + 1 };
}

export function writeInstallHint(storage: Pick<Storage, "setItem">, hint: InstallHint): void {
  try {
    storage.setItem(INSTALL_HINT_STORAGE_KEY, JSON.stringify(hint));
  } catch {
    // Bez pamäte sa pozvánka ukáže znova. Nepríjemné, ale nie dôvod na chybu.
  }
}

/**
 * Smie sa pozvánka ukázať sama?
 *
 * `null` v `hint` znamená „ešte nikdy nezavretá". Po vyčerpaní `INSTALL_SNOOZE_STEPS_MS`
 * je odpoveď navždy `false`.
 */
export function shouldOfferInstall({
  method,
  hint,
  now
}: {
  method: InstallMethod;
  hint: InstallHint | null;
  now: number;
}): boolean {
  if (method === "unavailable") return false;
  if (!hint) return true;

  const snooze = INSTALL_SNOOZE_STEPS_MS[hint.dismissals - 1];
  if (snooze === undefined) return false;

  // Hodnota z budúcnosti (posunuté hodiny, iné zariadenie, ručná úprava) sa neberie ako
  // „ticho navždy": rozdiel by bol negatívny a odklad by nikdy nevypršal.
  const elapsed = now - hint.dismissedAt;
  if (elapsed < 0) return true;
  return elapsed >= snooze;
}
