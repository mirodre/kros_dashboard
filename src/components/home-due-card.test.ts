import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HomeDueCard } from "./home-due-card";
import type { DueBandKey, DueDocument, DuePosition, DuePositions } from "@/lib/home-live";

// Statický render namiesto jsdom: karta nemá stav ani efekty, takže na otázku
// „nakreslili sa pruhy?" stačí HTML, ktoré z nej vypadne na serveri. Žiadna
// nová závislosť — react-dom už v projekte je.
function renderCard(positions: DuePositions) {
  return renderToStaticMarkup(
    createElement(HomeDueCard, { positions, isPeriodFocused: false })
  );
}

function document(
  key: string,
  band: DueBandKey,
  amount: number,
  daysOverdue: number | null
): DueDocument {
  return {
    key,
    partnerName: `Partner ${key}`,
    companyName: "Kros Trade",
    documentNumber: `2026${key}`,
    documentLabel: "Faktúra",
    dueDate: "2026-08-27",
    amount,
    band,
    daysOverdue
  };
}

function position(total: number, prefix: string): DuePosition {
  return {
    total,
    count: 3,
    bands: [
      { key: "due", label: "V splatnosti", total: total * 0.5, count: 1 },
      { key: "overdue", label: "Po splatnosti", total: total * 0.3, count: 1 },
      { key: "overdue60", label: "Po splatnosti nad 60 dní", total: total * 0.2, count: 1 }
    ],
    documents: [
      document(`${prefix}-a`, "overdue60", total * 0.2, 91),
      document(`${prefix}-b`, "overdue", total * 0.3, 10),
      document(`${prefix}-c`, "due", total * 0.5, null)
    ]
  };
}

const positions: DuePositions = {
  net: 400,
  receivables: position(1000, "r"),
  payables: position(600, "p"),
  receivablesAvailable: true
};

describe("HomeDueCard", () => {
  // Regresia: pri odstraňovaní zbaľovania karty spadli oba pruhy do vetvy
  // „stav úhrady nedostupný", takže v bežnom prípade — keď dáta sú — karta
  // ukázala len jedno číslo a graf zmizol. Tento test drží pruhy v karte
  // práve vtedy, keď je čo kresliť.
  it("kreslí pruhy oboch strán, aj keď je stav úhrady známy", () => {
    const html = renderCard(positions);

    expect(html).toContain("Mám dostať");
    expect(html).toContain("Mám zaplatiť");
    // Tri pásma na každej strane, teda šesť segmentov pruhu a šesť legiend.
    expect(html.match(/due-bar-segment/g)).toHaveLength(6);
    expect(html.match(/class="due-bar"/g)).toHaveLength(2);
    expect(html).toContain("V splatnosti");
    expect(html).toContain("Po splatnosti nad 60 dní");
  });

  // Zoznam dokladov sám je za portálom (`SheetOverlay` sa montuje až na klientovi),
  // takže na serveri sa dá overiť len to, čo ho otvára. Že sa otvorí a čo v ňom je,
  // drží typový systém a testy `computeDuePositions` nad `documents`.
  it("ponúka Zoznam dokladov, keď je čo vypísať", () => {
    const html = renderCard(positions);

    expect(html).toContain("Zoznam dokladov");
    // Pásma s dokladmi sa dajú rozkliknúť rovno z legendy.
    expect(html.match(/due-band-button/g)?.length).toBe(6);
  });

  it("bez dokladov nesľubuje zoznam, ktorý by bol prázdny", () => {
    const empty: DuePosition = { total: 0, count: 0, bands: [], documents: [] };
    const html = renderCard({
      net: 0,
      receivables: empty,
      payables: empty,
      receivablesAvailable: true
    });

    expect(html).not.toContain("Zoznam dokladov");
    expect(html).not.toContain("due-band-button");
  });

  it("bez stavu úhrady prizná chýbajúci údaj, ale záväzky kreslí ďalej", () => {
    const html = renderCard({ ...positions, receivablesAvailable: false });

    expect(html).toContain("Údaj z KROS nedostupný");
    expect(html).toContain("čiastka po vyrovnaní sa nedá spočítať");
    // Záväzky poznáme aj bez stavu úhrady faktúr — ich pruh ostáva.
    expect(html).toContain("Mám zaplatiť");
    expect(html.match(/class="due-bar"/g)).toHaveLength(1);
  });
});
