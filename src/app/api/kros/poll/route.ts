import { NextResponse } from "next/server";
import { appendKrosLog } from "@/lib/kros-logs";

const KROS_API_BASE = process.env.KROS_API_BASE_URL ?? "https://api-economy.kros.sk";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { state?: string };
    if (!body.state) {
      return NextResponse.json({ error: "Chýba parameter state" }, { status: 400 });
    }

    await appendKrosLog({
      direction: "request",
      endpoint: "/api/integration-subscription/poll",
      method: "POST",
      message: `Overujem state ${body.state.slice(0, 8)}...`
    });

    const response = await fetch(`${KROS_API_BASE}/api/integration-subscription/poll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: body.state }),
      cache: "no-store"
    });

    const payload = await response.json();
    await appendKrosLog({
      direction: "response",
      endpoint: "/api/integration-subscription/poll",
      method: "POST",
      status: response.status,
      message: `Stav: ${payload?.data?.status ?? "neznámy"}; payload=${JSON.stringify(payload)}`
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Overenie KROS prepojenia zlyhalo", details: payload },
        { status: response.status }
      );
    }

    return NextResponse.json(payload);
  } catch (error) {
    await appendKrosLog({
      direction: "error",
      endpoint: "/api/integration-subscription/poll",
      method: "POST",
      message: error instanceof Error ? error.message : "Neznáma chyba overenia prepojenia"
    });
    return NextResponse.json(
      { error: "Neočakávaná chyba overenia prepojenia", details: error instanceof Error ? error.message : "Neznáma chyba" },
      { status: 500 }
    );
  }
}
