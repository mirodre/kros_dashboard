import { NextResponse } from "next/server";
import { getPool } from "@/lib/db/pool";
import { appendKrosLog } from "@/lib/kros-logs";
import { postgresConnectionRepository } from "@/lib/kros-connections";
import { oauthStateStore } from "@/lib/kros-oauth-state";
import { scopeFromBinding } from "@/lib/preferences/scope";

type CallbackCompany = {
  companyId: number;
  companyName: string;
  token: string;
  webhookSecret?: string;
};

function parseCompanies(formData: FormData) {
  const companiesMap = new Map<number, Partial<CallbackCompany>>();

  for (const [key, rawValue] of formData.entries()) {
    const value = String(rawValue ?? "");
    const match = key.match(/^data\[(\d+)\]\[(companyId|companyName|token|webhookSecret)\]$/);
    if (!match) continue;

    const index = Number(match[1]);
    const field = match[2] as "companyId" | "companyName" | "token" | "webhookSecret";
    const current = companiesMap.get(index) ?? {};
    if (field === "companyId") {
      current.companyId = Number(value);
    } else if (field === "companyName") {
      current.companyName = value;
    } else if (field === "token") {
      current.token = value;
    } else {
      current.webhookSecret = value;
    }

    companiesMap.set(index, current);
  }

  return [...companiesMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, company]) => company)
    .filter(
      (company): company is CallbackCompany =>
        typeof company.companyId === "number" &&
        !Number.isNaN(company.companyId) &&
        typeof company.companyName === "string" &&
        company.companyName.length > 0 &&
        typeof company.token === "string" &&
        company.token.length > 0
    );
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const state = String(formData.get("state") ?? "") || null;
    const companies = parseCompanies(formData);

    const pool = getPool();
    if (!pool) {
      await appendKrosLog({
        direction: "error",
        endpoint: "/kros/callback",
        method: "POST",
        message: "Callback odmietnutý: appka nemá databázu, prepojenie sa nemá kam uložiť"
      });
      return NextResponse.redirect(new URL("/settings?kros_post_result=error", request.url), 303);
    }

    // `state` je jediné, čo o odosielateľovi vieme: cross-site POST z KROS neposiela
    // session cookie. Väzba na firmu vznikla pri jeho vydaní v `/api/kros/oauth-state`.
    const binding = state ? await oauthStateStore(pool).consume(state, new Date()) : null;

    if (!binding) {
      await appendKrosLog({
        direction: "error",
        endpoint: "/kros/callback",
        method: "POST",
        message: "Callback odmietnutý: neplatný alebo expirovaný state parameter"
      });
      return NextResponse.redirect(new URL("/settings?kros_post_result=error", request.url), 303);
    }

    if (companies.length === 0) {
      // KROS poslal callback bez použiteľnej firmy — tichý „úspech" by človeku ukázal
      // prázdny dashboard bez vysvetlenia.
      await appendKrosLog({
        direction: "error",
        endpoint: "/kros/callback",
        method: "POST",
        message: "Callback bez firiem: nie je čo prepojiť"
      });
      return NextResponse.redirect(new URL("/settings?kros_post_result=error", request.url), 303);
    }

    await postgresConnectionRepository(pool).save(
      scopeFromBinding(binding.tenantId, binding.userSub),
      companies
    );

    await appendKrosLog({
      direction: "response",
      endpoint: "/kros/callback",
      method: "POST",
      status: 200,
      message: `POST callback prijatý: firmy=${companies.length}, prepojenie uložené pre firmu`,
      payload: {
        // Token v logu nemá čo robiť — telá odpovedí sa tu pri chybách zapisujú na disk.
        companies: companies.map((company) => ({
          companyId: company.companyId,
          companyName: company.companyName
        }))
      }
    });

    // 303, aby prehliadač pokračoval GET-om: výsledok už je v databáze, prehliadač
    // nepotrebuje niesť nič. Do fázy 2 sa tu vracala HTML stránka, ktorá zoznam firiem aj
    // s tokenmi preniesla cez `sessionStorage` do `/settings`.
    return NextResponse.redirect(new URL("/settings?kros_post_result=1", request.url), 303);

  } catch (error) {
    await appendKrosLog({
      direction: "error",
      endpoint: "/kros/callback",
      method: "POST",
      message: `Spracovanie callbacku zlyhalo: ${error instanceof Error ? error.message : "Neznáma chyba"}`
    });

    return NextResponse.redirect(new URL("/settings?kros_post_result=error", request.url));
  }
}

export async function GET(request: Request) {
  return NextResponse.redirect(new URL("/settings", request.url));
}
