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
  description?: string;
  currency: string;
};
