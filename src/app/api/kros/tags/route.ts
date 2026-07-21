import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";

type CompanyConnection = {
  companyId: number;
  companyName: string;
  token: string;
};

type TagsRequestBody = {
  companies: CompanyConnection[];
};

const KROS_API_BASE = process.env.KROS_API_BASE_URL ?? "https://api-economy.kros.sk";

async function fetchCompanyTags(company: CompanyConnection) {
  await appendKrosLog({
    direction: "request",
    endpoint: "/api/tags",
    method: "GET",
    companyName: company.companyName,
    message: "Načítavam štítky"
  });

  const response = await fetch(`${KROS_API_BASE}/api/tags`, {
    headers: {
      Authorization: `Bearer ${company.token}`,
      Accept: "application/json"
    },
    cache: "no-store"
  });

  const payloadText = await response.text();
  let payload: unknown = {};
  try {
    payload = payloadText ? JSON.parse(payloadText) : {};
  } catch {
    payload = payloadText;
  }

  await appendKrosLog({
    direction: response.ok ? "response" : "error",
    endpoint: "/api/tags",
    method: "GET",
    companyName: company.companyName,
    status: response.status,
    message: response.ok
      ? "OK"
      : `Zlyhalo: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`,
    payload: response.ok ? undefined : typeof payload === "string" ? payload : payload
  });

  if (!response.ok) {
    throw new Error(
      `Načítanie štítkov zlyhalo pre firmu ${company.companyName} (${response.status}): ${
        typeof payload === "string" ? payload : JSON.stringify(payload)
      }`
    );
  }

  const items = Array.isArray((payload as { data?: unknown[] })?.data)
    ? (payload as { data: unknown[] }).data
    : [];

  return items.map((tag) => ({
    ...((tag as object) ?? {}),
    __company: company.companyName,
    __companyId: company.companyId
  }));
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TagsRequestBody;
    if (!Array.isArray(body.companies) || body.companies.length === 0) {
      return NextResponse.json({ error: "Neplatné telo požiadavky" }, { status: 400 });
    }

    const allTags: unknown[] = [];
    const errors: { companyName: string; message: string }[] = [];

    for (const company of body.companies) {
      try {
        const companyTags = await fetchCompanyTags(company);
        allTags.push(...companyTags);
      } catch (error) {
        errors.push({
          companyName: company.companyName,
          message: error instanceof Error ? error.message : "Neznáma chyba pri načítaní štítkov"
        });
      }
    }

    return NextResponse.json({ data: allTags, errors });
  } catch (error) {
    await appendKrosLog({
      direction: "error",
      endpoint: "/api/kros/tags",
      method: "POST",
      message: `Neočakávaná chyba načítania štítkov: ${error instanceof Error ? error.message : "Neznáma chyba"}`
    });
    return NextResponse.json({
      data: [],
      errors: [
        {
          companyName: "global",
          message: `Neočakávaná chyba načítania štítkov: ${error instanceof Error ? error.message : "Neznáma chyba"}`
        }
      ]
    });
  }
}
