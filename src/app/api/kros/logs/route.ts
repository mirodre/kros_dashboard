import { NextResponse } from "next/server";
import { clearKrosLogs, readKrosLogs } from "@/lib/kros-logs";

export async function GET() {
  const data = await readKrosLogs();
  return NextResponse.json({ data });
}

export async function DELETE() {
  await clearKrosLogs();
  return NextResponse.json({ ok: true });
}
