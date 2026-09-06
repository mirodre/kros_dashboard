import type {
  NormalizedExpense,
  NormalizedInvoice,
  NormalizedPaymentAccount,
  NormalizedPaymentTransaction
} from "./kros-types";

/**
 * Demo dáta Domova ako DOKLADY, nie ako hotové súčty.
 *
 * Mock zdroje modulov vracajú agregáty, z ktorých sa zisk, splatnosti ani DPH
 * nedajú spočítať. Doklady prejdú tými istými funkciami ako živé dáta, takže demo
 * ukazuje aj to, či výpočty fungujú — nie len či sa niečo vykreslí.
 *
 * Dátumy sú relatívne k `referenceDate`, aby demo nezostarlo: pevné dátumy by po
 * pár mesiacoch vypadli z okna grafu a demo by sa ukázalo prázdne.
 */
const COMPANIES = ["Kros Trade", "Kros Servis"] as const;
const TAGS = ["Retail", "Projekty", "Réžia"] as const;

function isoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

function shiftMonths(reference: Date, months: number, day: number) {
  return new Date(reference.getFullYear(), reference.getMonth() + months, day);
}

export function getHomeMockData(referenceDate: Date = new Date()) {
  const invoices: NormalizedInvoice[] = [];
  const expenses: NormalizedExpense[] = [];

  // `computeRevenueSeries`/`computeExpenseSeries` (dashboard-live.ts, expenses-live.ts)
  // orezávajú aktuálny mesiac a jeho lanský náprotivok na `date <= dnes`. Deň 12 by
  // preto v prvej polovici mesiaca vypadol z oboch okien a stĺpec „tento mesiac" by
  // bol prázdny. `safeDay` je preto najviac dnešný deň — a najviac 12, aby doklad
  // nespadol do ďalšieho mesiaca (nie každý mesiac má 31 dní).
  const safeDay = Math.min(12, referenceDate.getDate());

  // 18 mesiacov späť: tento rok aj vlaňajšok, nech má graf čo porovnávať.
  for (let offset = 17; offset >= 0; offset -= 1) {
    for (const [companyIndex, companyName] of COMPANIES.entries()) {
      const date = isoDate(shiftMonths(referenceDate, -offset, safeDay));
      const tag = TAGS[(offset + companyIndex) % TAGS.length];
      const income = 8000 + ((offset * 7 + companyIndex * 13) % 9) * 850;
      const spend = 5200 + ((offset * 5 + companyIndex * 11) % 7) * 720;

      invoices.push({
        id: `demo-inv-${offset}-${companyIndex}`,
        companyId: companyIndex + 1,
        companyName,
        invoiceNumber: `2026${String(offset).padStart(3, "0")}`,
        partnerName: `Odberateľ ${companyIndex + 1}`,
        issueDate: date,
        deliveryDate: date,
        totalPrice: income,
        vatAmount: Math.round(income * 0.2),
        paymentStatus: "fullyPaid",
        tags: [tag]
      });

      expenses.push({
        id: `demo-exp-${offset}-${companyIndex}`,
        companyId: companyIndex + 1,
        companyName,
        documentNumber: `D2026${String(offset).padStart(3, "0")}`,
        documentType: 10,
        partnerName: `Dodávateľ ${companyIndex + 1}`,
        issueDate: date,
        deliveryDate: date,
        totalPrice: spend,
        vatAmount: Math.round(spend * 0.2),
        paymentStatus: "fullyPaid",
        hasAttachments: false,
        tags: [tag],
        allocations: [{ tags: [tag], amount: spend }]
      });
    }
  }

  // Neuhradené doklady v troch pásmach splatnosti, nech je karta Pohľadávky
  // a záväzky vidieť celá — vrátane pásma nad 60 dní.
  const unpaid: { days: number; amount: number }[] = [
    { days: -20, amount: 4200 },
    { days: 12, amount: 3100 },
    { days: 95, amount: 1800 }
  ];
  for (const [index, item] of unpaid.entries()) {
    const due = new Date(referenceDate);
    due.setDate(due.getDate() - item.days);
    invoices.push({
      id: `demo-inv-unpaid-${index}`,
      companyId: 1,
      companyName: COMPANIES[0],
      partnerName: `Odberateľ ${index + 1}`,
      issueDate: isoDate(shiftMonths(referenceDate, -1, 5)),
      deliveryDate: isoDate(shiftMonths(referenceDate, -1, 5)),
      dueDate: isoDate(due),
      totalPrice: item.amount,
      vatAmount: Math.round(item.amount * 0.2),
      paymentStatus: "notPaid",
      tags: [TAGS[index % TAGS.length]]
    });
  }

  for (const [index, item] of unpaid.slice(0, 2).entries()) {
    const due = new Date(referenceDate);
    due.setDate(due.getDate() - item.days);
    expenses.push({
      id: `demo-exp-unpaid-${index}`,
      companyId: 1,
      companyName: COMPANIES[0],
      documentType: 10,
      partnerName: `Dodávateľ ${index + 1}`,
      issueDate: isoDate(shiftMonths(referenceDate, -1, 5)),
      deliveryDate: isoDate(shiftMonths(referenceDate, -1, 5)),
      dueDate: isoDate(due),
      totalPrice: Math.round(item.amount * 0.6),
      vatAmount: Math.round(item.amount * 0.12),
      paymentStatus: "notPaid",
      hasAttachments: false,
      tags: [TAGS[index % TAGS.length]],
      allocations: [{ tags: [TAGS[index % TAGS.length]], amount: Math.round(item.amount * 0.6) }]
    });
  }

  const accounts: NormalizedPaymentAccount[] = [
    {
      id: "demo-acc-1",
      companyId: 1,
      companyName: COMPANIES[0],
      name: "Slovenská sporiteľňa — bežný",
      type: "bank",
      currency: "EUR",
      startingBalance: 11480
    },
    {
      id: "demo-acc-2",
      companyId: 1,
      companyName: COMPANIES[0],
      name: "VÚB — sporiaci",
      type: "bank",
      currency: "EUR",
      startingBalance: 5260
    },
    {
      id: "demo-acc-3",
      companyId: 2,
      companyName: COMPANIES[1],
      name: "Pokladňa — hotovosť",
      type: "cash",
      currency: "EUR",
      startingBalance: 890
    }
  ];

  const transactions: NormalizedPaymentTransaction[] = [];

  return { invoices, expenses, accounts, transactions };
}
