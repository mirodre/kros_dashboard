import { describe, expect, it } from "vitest";
import { normalizeInvoices } from "./dashboard-live";

/** Hlavička faktúry v tvare, aký naozaj vracia KROS. */
function rawInvoice(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    issueDate: "2026-08-01T00:00:00",
    deliveryDate: "2026-08-01T00:00:00",
    dueDate: "2026-08-31T00:00:00",
    invoiceType: 0,
    paymentStatus: 1,
    __company: "Kros Trade",
    __companyId: 1,
    prices: {
      documentPrices: { totalPrice: 100, vatTotalPrice: 20 },
      legislativePrices: { totalPrice: 100, vatTotalPrice: 20 },
      exchangeRate: 1,
      currency: "EUR"
    },
    ...overrides
  };
}

describe("normalizeInvoices — suma a mena", () => {
  it("berie legislatívnu sumu, ktorá je v eurách", () => {
    expect(normalizeInvoices([rawInvoice()])[0].totalPrice).toBe(100);
  });

  it("cudziu menu NEPREPOČÍTAVA z documentPrices — tá je v mene dokladu", () => {
    // Česká faktúra: 67 919,39 CZK = 2 695 EUR. Do súčtu patrí eurová hodnota.
    const raw = rawInvoice({
      prices: {
        documentPrices: { totalPrice: 67919.39, vatTotalPrice: 0 },
        legislativePrices: { totalPrice: 2695, vatTotalPrice: 0 },
        exchangeRate: 25.202,
        currency: "CZK"
      }
    });
    expect(normalizeInvoices([raw])[0].totalPrice).toBe(2695);
  });

  it("doklad bez cien dá nulu, nie NaN", () => {
    expect(normalizeInvoices([rawInvoice({ prices: {} })])[0].totalPrice).toBe(0);
  });
});

describe("normalizeInvoices — splatnosť a stav úhrady", () => {
  it("prevezme dátum splatnosti", () => {
    expect(normalizeInvoices([rawInvoice()])[0].dueDate).toBe("2026-08-31T00:00:00");
  });

  it("mapuje kód stavu úhrady", () => {
    expect(normalizeInvoices([rawInvoice({ paymentStatus: 0 })])[0].paymentStatus).toBe("notPaid");
    expect(normalizeInvoices([rawInvoice({ paymentStatus: 1 })])[0].paymentStatus).toBe("fullyPaid");
    expect(normalizeInvoices([rawInvoice({ paymentStatus: 3 })])[0].paymentStatus).toBe(
      "partiallyPaid"
    );
  });

  it("faktúra bez stavu úhrady dostane 'undefined', nie 'notPaid'", () => {
    const raw = rawInvoice();
    delete (raw as Record<string, unknown>).paymentStatus;
    expect(normalizeInvoices([raw])[0].paymentStatus).toBe("undefined");
  });

  it("neznámy kód dostane 'undefined', nie tichý fallback na zaplatené", () => {
    expect(normalizeInvoices([rawInvoice({ paymentStatus: 99 })])[0].paymentStatus).toBe(
      "undefined"
    );
  });
});

describe("normalizeInvoices — DPH", () => {
  it("berie DPH z legislatívnych cien", () => {
    expect(normalizeInvoices([rawInvoice()])[0].vatAmount).toBe(20);
  });

  it("chýbajúca DPH ostane undefined, nie nula", () => {
    const raw = rawInvoice({
      prices: { legislativePrices: { totalPrice: 100 }, exchangeRate: 1, currency: "EUR" }
    });
    expect(normalizeInvoices([raw])[0].vatAmount).toBeUndefined();
  });

  it("nulová DPH je nula — oslobodené plnenie nie je chýbajúci údaj", () => {
    const raw = rawInvoice({
      prices: {
        legislativePrices: { totalPrice: 100, vatTotalPrice: 0 },
        exchangeRate: 1,
        currency: "EUR"
      }
    });
    expect(normalizeInvoices([raw])[0].vatAmount).toBe(0);
  });

  it("dobropis nesie zápornú sumu aj zápornú DPH — znamienko sa nikde neotáča", () => {
    const raw = rawInvoice({
      invoiceType: 1,
      prices: {
        legislativePrices: { totalPrice: -40.65, vatTotalPrice: -9.35 },
        exchangeRate: 1,
        currency: "EUR"
      }
    });
    const invoice = normalizeInvoices([raw])[0];
    expect(invoice.totalPrice).toBe(-40.65);
    expect(invoice.vatAmount).toBe(-9.35);
  });
});
