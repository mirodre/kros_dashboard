import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";

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

function renderCallbackPage(payload: { state: string | null; companies: CallbackCompany[] }) {
  const safePayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  const settingsUrl = "/settings?kros_post_result=1";

  return `<!DOCTYPE html>
<html lang="sk">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dokončujem prepojenie...</title>
  </head>
  <body style="font-family: Inter, Arial, sans-serif; background:#0a0d16; color:#eef3ff; margin:0; display:flex; min-height:100vh; align-items:center; justify-content:center;">
    <p>Dokončujem prepojenie s KROS...</p>
    <script>
      try {
        sessionStorage.setItem("kros_post_result", '${safePayload}');
      } catch (error) {
        console.error(error);
      }
      window.location.replace("${settingsUrl}");
    </script>
  </body>
</html>`;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const state = String(formData.get("state") ?? "") || null;
    const companies = parseCompanies(formData);

    await appendKrosLog({
      direction: "response",
      endpoint: "/kros/callback",
      method: "POST",
      status: 200,
      message: `POST callback prijatý: firmy=${companies.length}${state ? ", state je prítomný" : ""}`,
      payload: {
        state,
        companies: companies.map((company) => ({
          companyId: company.companyId,
          companyName: company.companyName
        }))
      }
    });

    return new NextResponse(renderCallbackPage({ state, companies }), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });
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
