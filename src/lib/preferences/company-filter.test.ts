import { describe, expect, it } from "vitest";

import { applyCompanyFilter } from "@/lib/preferences/company-filter";

const nameOf = (item: { companyName: string }) => item.companyName;
const dostupne = [{ companyName: "Firma A" }, { companyName: "Firma B" }];

describe("applyCompanyFilter", () => {
  it("prazdny vyber znamena vsetky dostupne", () => {
    const result = applyCompanyFilter(dostupne, [], nameOf);

    expect(result.companies).toEqual(dostupne);
    expect(result.noneAvailable).toBe(false);
  });

  it("vyber sa oreze na dostupne firmy", () => {
    const result = applyCompanyFilter(dostupne, ["Firma B", "Firma Z"], nameOf);

    expect(result.companies).toEqual([{ companyName: "Firma B" }]);
    expect(result.noneAvailable).toBe(false);
  });

  it("neprazdny vyber bez prieniku hlasi noneAvailable, nie ticho nulu", () => {
    // Filter prineseny z ineho zariadenia, kde su prepojene ine firmy. Tichá nula by
    // vyzerala ako „firma nema trzby".
    const result = applyCompanyFilter(dostupne, ["Firma Z"], nameOf);

    expect(result.companies).toEqual([]);
    expect(result.noneAvailable).toBe(true);
  });

  it("bez akychkolvek pripojeni to nie je chyba filtra", () => {
    // Vtedy patri hlaska o prepojeni s KROS, nie o nesediacom filtri.
    const result = applyCompanyFilter([], ["Firma Z"], nameOf);

    expect(result.companies).toEqual([]);
    expect(result.noneAvailable).toBe(false);
  });

  it("nesahá na poradie ani na vstupne pole", () => {
    const vstup = [...dostupne];
    const result = applyCompanyFilter(vstup, [], nameOf);

    result.companies.push({ companyName: "Firma C" });
    expect(vstup).toHaveLength(2);
  });
});
