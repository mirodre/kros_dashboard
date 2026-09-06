/**
 * Prepojená firma tak, ako ju vidí prehliadač. Token tu ZÁMERNE nie je: od fázy 2 žije
 * šifrovaný v databáze a klient posiela len `companyId`.
 */
export type KrosConnection = {
  companyId: number;
  companyName: string;
  connectedAt: string;
};

export type NormalizedInvoice = {
  id: string;
  companyId?: number;
  companyName: string;
  invoiceNumber?: string;
  partnerName?: string;
  issueDate: string;
  /** Dátum dodania (DUZP) — analytiky bucketujú podľa neho, s fallbackom na issueDate. */
  deliveryDate?: string;
  lastModifiedTimestamp?: string;
  totalPrice: number;
  tags: string[];
  /** Dátum splatnosti — bez neho sa faktúra nedá zaradiť medzi po splatnosti. */
  dueDate?: string;
  paymentStatus: DocumentPaymentStatus;
  /**
   * DPH z dokladu v EUR (`prices.legislativePrices.vatTotalPrice`). Dobropis ju
   * nesie už zápornú, takže sa nikde neotáča znamienko. `undefined` znamená,
   * že ju KROS nevrátil — a to je iná správa než nula.
   */
  vatAmount?: number;
};

export type AggregatedRevenuePoint = {
  label: string;
  current: number;
  previous: number;
};

export type AggregatedBreakdownPoint = {
  name: string;
  amount: number;
  previousAmount: number;
};

/**
 * Kód stavu úhrady dokladu z KROS API. Faktúry aj výdavky používajú tie isté
 * číselné kódy (0 notPaid, 1 fullyPaid, 2 overPaid, 3 partiallyPaid), preto je
 * typ spoločný pre oba doklady, nielen pre výdavky.
 */
export type DocumentPaymentStatus = "notPaid" | "fullyPaid" | "overPaid" | "partiallyPaid" | "undefined";

/**
 * Jedna položka rozúčtovania výdavku na štítky. Vzniká z riadkov journalItems
 * (endpoint /api/expenses/{id}); riadok bez vlastných štítkov zdedí štítky
 * z hlavičky dokladu. Doklad bez riadkov má jedinú položku z hlavičky.
 */
export type ExpenseTagAllocation = {
  tags: string[];
  /** Legislatívna suma bez DPH so znamienkom. */
  amount: number;
};

export type NormalizedExpense = {
  id: string;
  companyId?: number;
  companyName: string;
  documentNumber?: string;
  /** KROS document type (10 ReceivedInvoice, 11 Receipt, 13 InternalDocument, 14 BankNotification, 15 ReceivedProformaInvoice, 17 ReceivedCreditNote, 19 ReceivedDebitNote). */
  documentType: number;
  partnerName?: string;
  issueDate: string;
  /** Dátum dodania (DUZP) — analytiky bucketujú podľa neho, s fallbackom na issueDate. */
  deliveryDate?: string;
  dueDate?: string;
  receivedDate?: string;
  lastModifiedTimestamp?: string;
  /**
   * Legislatívna suma bez DPH so znamienkom (dobropisy sú záporné). Berie sa
   * zo súčtu rozúčtovania (journalItems), s fallbackom na hlavičku dokladu —
   * pozri readExpenseAmounts v expenses-live.ts.
   */
  totalPrice: number;
  /**
   * Suma celého dokladu pred zúžením na aktívny filter štítkov. Vyplní ju až
   * `scopeExpenseAmountsToTagFilters`, a to len keď sa `totalPrice` naozaj zúžila —
   * zoznamy dokladov tak vedia ukázať, z akého celku je zobrazená časť.
   */
  documentTotalPrice?: number;
  paymentStatus: DocumentPaymentStatus;
  paymentType?: string;
  hasAttachments: boolean;
  /** Zjednotenie štítkov zo všetkých rozúčtovaní — na filtrovanie dokladov. */
  tags: string[];
  /** Rozúčtovanie sumy na štítky; súčet `amount` dáva `totalPrice`. */
  allocations: ExpenseTagAllocation[];
  /**
   * DPH z hlavičky dokladu v EUR (`prices.legislativePrices.vatTotalPrice`).
   * Dobropis ju nesie už zápornú, rovnako ako sumu — znamienko sa nikde
   * neotáča. `undefined` = KROS ju nevrátil (iná správa než nula).
   */
  vatAmount?: number;
};

export type NormalizedPaymentAccount = {
  id: string;
  companyId?: number;
  companyName: string;
  name: string;
  type: "bank" | "cash" | "gateway" | "other";
  currency: string;
  startingBalance: number;
};

export type NormalizedPaymentTransaction = {
  id: string;
  companyId?: number;
  companyName: string;
  accountId: string;
  accountName: string;
  partnerName?: string;
  remittanceInformation?: string;
  hasMatchedDocuments: boolean;
  isWithoutDocument: boolean;
  amount: number;
  bookedAt: string;
  lastModifiedTimestamp?: string;
  description?: string;
  currency: string;
};
