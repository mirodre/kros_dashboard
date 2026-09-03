import { NextResponse } from "next/server";

import {
  listConnections,
  removeConnection,
  saveConnections
} from "@/lib/kros-connection-handlers";
import { krosContext, readBody, toResponse } from "../context";

/** Zoznam firiem prepojených touto firmou. Bez tokenov — tie server nikdy nevydá. */
export async function GET(): Promise<NextResponse> {
  const context = await krosContext();
  if (context instanceof NextResponse) return context;

  return toResponse(await listConnections(context.connections, context.scope));
}

/**
 * Nahranie prepojení z prehliadača. Slúži len na jednorazový presun toho, čo ľuďom ostalo
 * v `localStorage` z čias pred fázou 2 — nové prepojenia zapisuje `/kros/callback` sám.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const context = await krosContext();
  if (context instanceof NextResponse) return context;

  return toResponse(await saveConnections(context.connections, context.scope, await readBody(request)));
}

/** Odpojenie firmy. Je to akcia za celú firmu — dialóg v Nastaveniach to musí povedať. */
export async function DELETE(request: Request): Promise<NextResponse> {
  const context = await krosContext();
  if (context instanceof NextResponse) return context;

  return toResponse(await removeConnection(context.connections, context.scope, await readBody(request)));
}
