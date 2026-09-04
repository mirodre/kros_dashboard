import { describe, expect, it } from "vitest";

import { computeCashflowOverviewFromLiveData } from "./cashflow-live";
import type { NormalizedPaymentAccount, NormalizedPaymentTransaction } from "./kros-types";

const accounts: NormalizedPaymentAccount[] = [
  {
    id: "acc-a",
    companyId: 1,
    companyName: "Firma A",
    name: "Bežný účet A",
    type: "bank",
    currency: "EUR",
    startingBalance: 1000
  },
  {
    id: "acc-b",
    companyId: 2,
    companyName: "Firma B",
    name: "Bežný účet B",
    type: "bank",
    currency: "EUR",
    startingBalance: 500
  }
];

const transactions: NormalizedPaymentTransaction[] = [];

describe("computeCashflowOverviewFromLiveData – rozsah firiem", () => {
  it("prazdny vyber znamena vsetky firmy", () => {
    const overview = computeCashflowOverviewFromLiveData({
      accounts,
      transactions,
      granularity: "month",
      selectedCompanies: []
    });

    expect(overview.accountBreakdown.map((account) => account.id)).toEqual(["acc-a", "acc-b"]);
  });

  it("vyber firmy zuzi ucty na zvolenu firmu", () => {
    const overview = computeCashflowOverviewFromLiveData({
      accounts,
      transactions,
      granularity: "month",
      selectedCompanies: ["Firma A"],
      selectedCompanyIds: [1]
    });

    expect(overview.accountBreakdown.map((account) => account.id)).toEqual(["acc-a"]);
    expect(overview.companyBreakdown.map((company) => company.name)).toEqual(["Firma A"]);
  });

  it("id-cko najde firmu aj po premenovani v KROSe", () => {
    const overview = computeCashflowOverviewFromLiveData({
      accounts,
      transactions,
      granularity: "month",
      selectedCompanies: ["Firma A s.r.o."],
      selectedCompanyIds: [1]
    });

    expect(overview.accountBreakdown.map((account) => account.id)).toEqual(["acc-a"]);
  });
});
