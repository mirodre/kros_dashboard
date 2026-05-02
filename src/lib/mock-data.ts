import type { NormalizedInvoice } from "./kros-types";

export type Granularity = "week" | "month" | "year";

export type KpiCard = {
  title: string;
  currentValue: number;
  previousValue: number;
  deltaPct: number;
};

export type RevenuePoint = {
  label: string;
  current: number;
  previous: number;
};

export type TagPoint = {
  name: string;
  amount: number;
  previousAmount: number;
};

export type CompanyPoint = {
  name: string;
  amount: number;
  previousAmount: number;
};

const mockByGranularity: Record<Granularity, RevenuePoint[]> = {
  week: [
    { label: "T01", current: 21400, previous: 19900 },
    { label: "T02", current: 23100, previous: 20500 },
    { label: "T03", current: 22600, previous: 21300 },
    { label: "T04", current: 24500, previous: 21800 },
    { label: "T05", current: 23900, previous: 22400 },
    { label: "T06", current: 25200, previous: 23000 }
  ],
  month: [
    { label: "jan", current: 84200, previous: 78100 },
    { label: "feb", current: 79900, previous: 81200 },
    { label: "mar", current: 92400, previous: 85800 },
    { label: "apr", current: 95700, previous: 88900 },
    { label: "máj", current: 100200, previous: 91400 },
    { label: "jún", current: 103600, previous: 96100 }
  ],
  year: [
    { label: "2021", current: 1152000, previous: 1043000 },
    { label: "2022", current: 1267000, previous: 1152000 },
    { label: "2023", current: 1389000, previous: 1267000 },
    { label: "2024", current: 1478000, previous: 1389000 },
    { label: "2025", current: 1594000, previous: 1478000 }
  ]
};

const tagDataByGranularity: Record<Granularity, TagPoint[]> = {
  week: [
    { name: "Retail", amount: 45500, previousAmount: 42000 },
    { name: "B2B", amount: 31200, previousAmount: 28900 },
    { name: "Subscriptions", amount: 25900, previousAmount: 23800 },
    { name: "Nedefinované", amount: 7600, previousAmount: 8900 }
  ],
  month: [
    { name: "Retail", amount: 182400, previousAmount: 171200 },
    { name: "B2B", amount: 147800, previousAmount: 136500 },
    { name: "Subscriptions", amount: 106300, previousAmount: 96800 },
    { name: "Nedefinované", amount: 21500, previousAmount: 24900 }
  ],
  year: [
    { name: "Retail", amount: 1874000, previousAmount: 1769000 },
    { name: "B2B", amount: 1457000, previousAmount: 1335000 },
    { name: "Subscriptions", amount: 1189000, previousAmount: 1092000 },
    { name: "Nedefinované", amount: 211300, previousAmount: 247000 }
  ]
};

const companyDataByGranularity: Record<Granularity, CompanyPoint[]> = {
  week: [
    { name: "Kros Trade", amount: 39800, previousAmount: 36400 },
    { name: "Kros Services", amount: 34200, previousAmount: 31900 },
    { name: "Kros Retail", amount: 26200, previousAmount: 24700 }
  ],
  month: [
    { name: "Kros Trade", amount: 158400, previousAmount: 147300 },
    { name: "Kros Services", amount: 142100, previousAmount: 133900 },
    { name: "Kros Retail", amount: 124900, previousAmount: 112200 }
  ],
  year: [
    { name: "Kros Trade", amount: 1629000, previousAmount: 1516000 },
    { name: "Kros Services", amount: 1482000, previousAmount: 1393000 },
    { name: "Kros Retail", amount: 1279000, previousAmount: 1161000 }
  ]
};

export function getRevenueChartPointsByTags(
  granularity: Granularity,
  selectedTags: string[] = [],
  selectedCompanies: string[] = []
): RevenuePoint[] {
  const points = mockByGranularity[granularity];
  const tagWeights = getTagWeight(granularity, selectedTags);
  const companyWeights = getCompanyWeight(granularity, selectedCompanies);
  const currentWeight = (tagWeights?.currentWeight ?? 1) * (companyWeights?.currentWeight ?? 1);
  const previousWeight = (tagWeights?.previousWeight ?? 1) * (companyWeights?.previousWeight ?? 1);

  if (currentWeight === 1 && previousWeight === 1) return points;

  return points.map((point) => ({
    label: point.label,
    current: Math.round(point.current * currentWeight),
    previous: Math.round(point.previous * previousWeight)
  }));
}

export function getKpiCards(
  granularity: Granularity,
  selectedTags: string[] = [],
  selectedCompanies: string[] = []
): KpiCard[] {
  const points = getRevenueChartPointsByTags(granularity, selectedTags, selectedCompanies);
  const currentBucket = points.length > 0 ? points[points.length - 1] : null;
  const currentPeriodCurrent = currentBucket?.current ?? 0;
  const currentPeriodPrevious = currentBucket?.previous ?? 0;
  const periodCurrent = points.reduce((sum, p) => sum + p.current, 0);
  const periodPrevious = points.reduce((sum, p) => sum + p.previous, 0);
  const tagWeights = getTagWeight(granularity, selectedTags);
  const companyWeights = getCompanyWeight(granularity, selectedCompanies);
  const currentWeight = (tagWeights?.currentWeight ?? 1) * (companyWeights?.currentWeight ?? 1);
  const previousWeight = (tagWeights?.previousWeight ?? 1) * (companyWeights?.previousWeight ?? 1);
  const ytdCurrent = Math.round(578200 * currentWeight);
  const ytdPrevious = Math.round(534900 * previousWeight);

  return [
    {
      title: "Tržby v aktuálnom období",
      currentValue: currentPeriodCurrent,
      previousValue: currentPeriodPrevious,
      deltaPct: getDelta(currentPeriodCurrent, currentPeriodPrevious)
    },
    {
      title: "Kumulované tržby tento rok",
      currentValue: ytdCurrent,
      previousValue: ytdPrevious,
      deltaPct: getDelta(ytdCurrent, ytdPrevious)
    },
    {
      title: "Priemer na obdobie",
      currentValue: Math.round(periodCurrent / points.length),
      previousValue: Math.round(periodPrevious / points.length),
      deltaPct: getDelta(periodCurrent / points.length, periodPrevious / points.length)
    }
  ];
}

export function getTagsBreakdown(granularity: Granularity): TagPoint[] {
  return tagDataByGranularity[granularity];
}

export function getCompaniesBreakdown(granularity: Granularity): CompanyPoint[] {
  return companyDataByGranularity[granularity];
}

/** Demo faktúry pre sekciu „Posledné faktúry“ bez pripojených firiem (rovnaké názvy firiem a štítkov ako v mock grafoch). */
export function getMockRecentInvoices(referenceDate: Date = new Date()): NormalizedInvoice[] {
  const iso = (daysAgo: number) => {
    const d = new Date(referenceDate);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  };

  const rows: Omit<NormalizedInvoice, "id">[] = [
    {
      companyName: "Kros Trade",
      partnerName: "TechPartner SK s.r.o.",
      issueDate: iso(0),
      totalPrice: 18_200,
      tags: ["B2B"],
      invoiceNumber: "FV 2026/188"
    },
    {
      companyName: "Kros Services",
      partnerName: "GreenFood a.s.",
      issueDate: iso(1),
      totalPrice: 9_450,
      tags: ["Retail"],
      invoiceNumber: "FV 2026/042"
    },
    {
      companyName: "Kros Retail",
      partnerName: "Mestský úrad Bratislava",
      issueDate: iso(2),
      totalPrice: 42_800,
      tags: ["B2B"],
      invoiceNumber: "FV 2026/301"
    },
    {
      companyName: "Kros Trade",
      partnerName: "Logistika Plus s.r.o.",
      issueDate: iso(3),
      totalPrice: 6_200,
      tags: ["Nedefinované"],
      invoiceNumber: "FV 2026/187"
    },
    {
      companyName: "Kros Services",
      partnerName: "Streamio EU",
      issueDate: iso(4),
      totalPrice: 3_990,
      tags: ["Subscriptions"],
      invoiceNumber: "FV 2026/041"
    },
    {
      companyName: "Kros Retail",
      partnerName: "Nákupné centrum Central",
      issueDate: iso(6),
      totalPrice: 28_300,
      tags: ["Retail"],
      invoiceNumber: "FV 2026/300"
    },
    {
      companyName: "Kros Trade",
      partnerName: "AutoServis Novák",
      issueDate: iso(8),
      totalPrice: 2_180,
      tags: ["Retail"],
      invoiceNumber: "FV 2026/186"
    },
    {
      companyName: "Kros Services",
      partnerName: "BuildMax s.r.o.",
      issueDate: iso(10),
      totalPrice: 55_600,
      tags: ["B2B"],
      invoiceNumber: "FV 2026/040"
    },
    {
      companyName: "Kros Retail",
      partnerName: "E-shop Slovensko",
      issueDate: iso(12),
      totalPrice: 4_120,
      tags: ["Subscriptions"],
      invoiceNumber: "FV 2026/299"
    },
    {
      companyName: "Kros Trade",
      partnerName: "Kancelárske potreby s.r.o.",
      issueDate: iso(14),
      totalPrice: 890,
      tags: ["Retail"],
      invoiceNumber: "FV 2026/185"
    },
    {
      companyName: "Kros Services",
      partnerName: "Wellness Club",
      issueDate: iso(18),
      totalPrice: 12_400,
      tags: ["Retail"],
      invoiceNumber: "FV 2026/039"
    },
    {
      companyName: "Kros Retail",
      partnerName: "Dopravný podnik",
      issueDate: iso(22),
      totalPrice: 71_200,
      tags: ["B2B"],
      invoiceNumber: "FV 2026/298"
    },
    {
      companyName: "Kros Trade",
      partnerName: "SoftHouse EU",
      issueDate: iso(30),
      totalPrice: 19_900,
      tags: ["B2B"],
      invoiceNumber: "FV 2026/184"
    },
    {
      companyName: "Kros Services",
      partnerName: "Farmárska predajňa",
      issueDate: iso(45),
      totalPrice: 1_650,
      tags: ["Nedefinované"],
      invoiceNumber: "FV 2026/038"
    }
  ];

  return rows.map((row, index) => ({
    ...row,
    id: `mock-invoice-${index}-${row.issueDate}`
  }));
}

function getTagWeight(granularity: Granularity, selectedTags: string[]) {
  if (selectedTags.length === 0) return null;

  const tags = tagDataByGranularity[granularity];
  const selected = tags.filter((tag) => selectedTags.includes(tag.name));
  if (selected.length === 0) return null;

  const totalCurrent = tags.reduce((sum, tag) => sum + tag.amount, 0);
  const totalPrevious = tags.reduce((sum, tag) => sum + tag.previousAmount, 0);
  const selectedCurrent = selected.reduce((sum, tag) => sum + tag.amount, 0);
  const selectedPrevious = selected.reduce((sum, tag) => sum + tag.previousAmount, 0);

  return {
    currentWeight: totalCurrent === 0 ? 1 : selectedCurrent / totalCurrent,
    previousWeight: totalPrevious === 0 ? 1 : selectedPrevious / totalPrevious
  };
}

function getCompanyWeight(granularity: Granularity, selectedCompanies: string[]) {
  if (selectedCompanies.length === 0) return null;

  const companies = companyDataByGranularity[granularity];
  const selected = companies.filter((company) => selectedCompanies.includes(company.name));
  if (selected.length === 0) return null;

  const totalCurrent = companies.reduce((sum, company) => sum + company.amount, 0);
  const totalPrevious = companies.reduce((sum, company) => sum + company.previousAmount, 0);
  const selectedCurrent = selected.reduce((sum, company) => sum + company.amount, 0);
  const selectedPrevious = selected.reduce((sum, company) => sum + company.previousAmount, 0);

  return {
    currentWeight: totalCurrent === 0 ? 1 : selectedCurrent / totalCurrent,
    previousWeight: totalPrevious === 0 ? 1 : selectedPrevious / totalPrevious
  };
}

function getDelta(current: number, previous: number) {
  if (previous === 0) {
    return 100;
  }

  return ((current - previous) / previous) * 100;
}
