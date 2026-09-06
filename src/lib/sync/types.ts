import type { Granularity } from "@/lib/mock-data";
import type {
  KrosConnection,
  NormalizedExpense,
  NormalizedInvoice,
  NormalizedPaymentAccount,
  NormalizedPaymentTransaction
} from "@/lib/kros-types";
import type { SyncStep } from "@/lib/sync-progress-types";

/**
 * Všetko, čo appka vie mať stiahnuté. Zámerne jeden uzavretý tvar, nie generický
 * parameter na engine: vďaka tomu orchestrátor zlúči výsledky troch enginov bez
 * jediného pretypovania a stránka dostane hotové polia.
 */
export type SyncData = {
  invoices: NormalizedInvoice[];
  expenses: NormalizedExpense[];
  accounts: NormalizedPaymentAccount[];
  transactions: NormalizedPaymentTransaction[];
};

export const EMPTY_SYNC_DATA: SyncData = {
  invoices: [],
  expenses: [],
  accounts: [],
  transactions: []
};

export type PlanContext = {
  /** Firmy, ktoré sa majú synchronizovať — už po aplikovaní filtra firiem. */
  connections: KrosConnection[];
  companyIds: number[];
  granularity: Granularity;
  /** Ručné obnovenie doťahuje aj zmeny; automatické otvorenie len chýbajúce mesiace. */
  isManualRefresh: boolean;
  signal: AbortSignal;
};

export type RunContext = {
  signal: AbortSignal;
  /**
   * Priebeh vnútri kroku (0–1) a jeho bližší popis. Engine tak nevie nič
   * o `sync-progress-store` — vlastníkom ukazovateľa je orchestrátor.
   */
  onProgress: (fraction: number, detail?: string) => void;
};

/**
 * Jedna doména sťahovania. `plan` a `run` sú oddelené zámerne: plán poznáme pred
 * prvým fetchom, takže ukazovateľ priebehu vie zobraziť celok práce namiesto
 * nekonečného loadera — a dá sa otestovať bez siete.
 */
export type SyncEngine<TStep = unknown> = {
  /** Ladiaci názov domény, napr. `"invoices"`. */
  readonly key: string;
  /** Prečíta IndexedDB cache — bez siete. */
  hydrate(companyIds: number[]): Promise<Partial<SyncData>>;
  plan(ctx: PlanContext): Promise<TStep[]>;
  /** Krok tak, ako ho vidí človek na obrazovke sťahovania. */
  describe(step: TStep): SyncStep;
  /** fetch → normalizácia → zápis do cache → syncMeta. */
  run(step: TStep, ctx: RunContext): Promise<void>;
};

/**
 * Engine so zabudnutým typom kroku. Orchestrátor drží tri enginy s tromi rôznymi
 * typmi krokov v jednom poli a každý krok vracia späť len tomu enginu, od ktorého
 * ho dostal — typ kroku sa teda mimo enginu nikdy nečíta.
 *
 * `unknown` tu nestačí: `plan()` enginu vracia `InvoiceSyncStep[]`, čo nie je
 * priraditeľné k `unknown[]` v protismere, a `SyncEngine<never>` by nesedelo tiež.
 * Toto je presne ten prípad, na aký `any` je.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnySyncEngine = SyncEngine<any>;
