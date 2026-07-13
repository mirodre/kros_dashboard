export type KrosConnection = {
  companyId: number;
  companyName: string;
  token: string;
  webhookSecret?: string;
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

export type ExpensePaymentStatus = "notPaid" | "fullyPaid" | "overPaid" | "partiallyPaid" | "undefined";

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
  /** Suma s DPH so znamienkom — dobropisy sú záporné, ide o reálny peňažný dopad. */
  totalPriceInclVat: number;
  vatTotalPrice: number;
  paymentStatus: ExpensePaymentStatus;
  paymentType?: string;
  hasAttachments: boolean;
  tags: string[];
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
