import { NextResponse } from "next/server";

import { putTenant } from "@/lib/preferences/handlers";
import { preferenceContext, readBody, toResponse } from "../context";

/**
 * Firemné predvolené. Rolu nekontroluje — rozhodnutie z 3.9.2026: smie to hocikto v tenante.
 * Hranicou je teda výhradne `tenantId` zo session (`preferenceContext`), stopou `updated_by_sub`.
 */
export async function PUT(request: Request): Promise<NextResponse> {
  const context = await preferenceContext();
  if (context instanceof NextResponse) return context;

  return toResponse(await putTenant(context.repository, context.scope, await readBody(request)));
}
