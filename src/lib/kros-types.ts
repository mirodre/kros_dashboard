export type KrosConnection = {
  companyId: number;
  companyName: string;
  token: string;
  webhookSecret?: string;
  connectedAt: string;
};

export type NormalizedInvoice = {
  companyName: string;
  issueDate: string;
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
