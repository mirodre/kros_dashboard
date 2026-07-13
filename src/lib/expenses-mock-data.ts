import type { NormalizedExpense } from "./kros-types";

/**
 * Demo výdavky pre režim bez pripojených firiem. Generujú sa ako normalizované
 * doklady a tečú cez rovnaký výpočtový pipeline ako živé dáta, takže demo
 * verne ukazuje správanie celého modulu (KPI, donut, splatnosti, dodávatelia).
 */

type VendorTemplate = {
  vendor: string;
  tag: string;
  companyName: string;
  /** Približná mesačná útrata v EUR. */
  monthlyAmount: number;
  documentType: number;
  paymentType?: string;
};

const VENDOR_TEMPLATES: VendorTemplate[] = [
  { vendor: "Reality Invest s.r.o.", tag: "Nájom", companyName: "Kros Trade", monthlyAmount: 2400, documentType: 10, paymentType: "Prevod" },
  { vendor: "SPP a.s.", tag: "Energie", companyName: "Kros Trade", monthlyAmount: 640, documentType: 10, paymentType: "Inkaso" },
  { vendor: "ZSE Energia", tag: "Energie", companyName: "Kros Retail", monthlyAmount: 480, documentType: 10, paymentType: "Inkaso" },
  { vendor: "VeľkoSklad SK", tag: "Materiál", companyName: "Kros Trade", monthlyAmount: 5200, documentType: 10, paymentType: "Prevod" },
  { vendor: "Baliace centrum", tag: "Materiál", companyName: "Kros Retail", monthlyAmount: 1150, documentType: 10, paymentType: "Prevod" },
  { vendor: "Google Ireland", tag: "Marketing", companyName: "Kros Services", monthlyAmount: 1900, documentType: 10, paymentType: "Karta" },
  { vendor: "Meta Platforms", tag: "Marketing", companyName: "Kros Retail", monthlyAmount: 840, documentType: 10, paymentType: "Karta" },
  { vendor: "WebSupport", tag: "IT a softvér", companyName: "Kros Services", monthlyAmount: 210, documentType: 10, paymentType: "Karta" },
  { vendor: "Microsoft Ireland", tag: "IT a softvér", companyName: "Kros Services", monthlyAmount: 460, documentType: 10, paymentType: "Karta" },
  { vendor: "Slovnaft a.s.", tag: "Doprava", companyName: "Kros Trade", monthlyAmount: 720, documentType: 11, paymentType: "Karta" },
  { vendor: "DPD SK", tag: "Doprava", companyName: "Kros Retail", monthlyAmount: 980, documentType: 10, paymentType: "Prevod" },
  { vendor: "Účtovníctvo Plus", tag: "Služby", companyName: "Kros Trade", monthlyAmount: 550, documentType: 10, paymentType: "Prevod" },
  { vendor: "Kaviareň Centrálka", tag: "Nedefinované", companyName: "Kros Services", monthlyAmount: 90, documentType: 11, paymentType: "Karta" }
];

function seededAmount(base: number, year: number, month: number, index: number) {
  // Deterministický "šum" ±18 % + mierny medziročný rast, aby demo pôsobilo živo.
  const wave = Math.sin(year * 3 + month * 1.7 + index * 2.3);
  const growth = year % 2 === 0 ? 1.06 : 1;
  return Math.round(base * growth * (1 + wave * 0.18) * 100) / 100;
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getMockExpenses(referenceDate: Date = new Date()): NormalizedExpense[] {
  const expenses: NormalizedExpense[] = [];
  const currentYear = referenceDate.getFullYear();
  const years = [currentYear - 1, currentYear];

  for (const year of years) {
    const lastMonth = year === currentYear ? referenceDate.getMonth() : 11;
    for (let month = 0; month <= lastMonth; month += 1) {
      VENDOR_TEMPLATES.forEach((template, index) => {
        const day = Math.min(3 + ((index * 5 + month * 2) % 24), 28);
        const issue = new Date(year, month, day);
        if (issue > referenceDate) return;

        const amount = seededAmount(template.monthlyAmount, year, month, index);
        const due = new Date(issue);
        due.setDate(due.getDate() + 14);

        // Posledné dva mesiace nechávame časť dokladov neuhradených,
        // aby demo ukázalo stráženie splatností.
        const monthsFromNow =
          (referenceDate.getFullYear() - year) * 12 + (referenceDate.getMonth() - month);
        const isRecent = monthsFromNow <= 1;
        const staysUnpaid = isRecent && index % 3 === 0;

        expenses.push({
          id: `mock-expense-${year}-${month}-${index}`,
          companyName: template.companyName,
          documentNumber: `DF ${year}/${String(month * VENDOR_TEMPLATES.length + index + 1).padStart(3, "0")}`,
          documentType: template.documentType,
          partnerName: template.vendor,
          issueDate: isoDate(year, month, day),
          dueDate: isoDate(due.getFullYear(), due.getMonth(), due.getDate()),
          totalPrice: Math.round((amount / 1.23) * 100) / 100,
          totalPriceInclVat: amount,
          vatTotalPrice: Math.round((amount / 1.23) * 0.23 * 100) / 100,
          paymentStatus: staysUnpaid ? (index % 2 === 0 ? "notPaid" : "partiallyPaid") : "fullyPaid",
          paymentType: template.paymentType,
          hasAttachments: index % 4 === 0,
          tags: [template.tag]
        });
      });
    }
  }

  // Jeden dobropis, nech vidno záporný doklad v prehľadoch.
  const creditMonth = Math.max(referenceDate.getMonth() - 1, 0);
  expenses.push({
    id: `mock-expense-credit-${currentYear}`,
    companyName: "Kros Trade",
    documentNumber: `DD ${currentYear}/001`,
    documentType: 17,
    partnerName: "VeľkoSklad SK",
    issueDate: isoDate(currentYear, creditMonth, 20),
    dueDate: isoDate(currentYear, creditMonth, 27),
    totalPrice: -260.16,
    totalPriceInclVat: -320,
    vatTotalPrice: -59.84,
    paymentStatus: "fullyPaid",
    paymentType: "Prevod",
    hasAttachments: false,
    tags: ["Materiál"]
  });

  return expenses;
}

export const EXPENSES_MOCK_COMPANIES = ["Kros Trade", "Kros Services", "Kros Retail"];
