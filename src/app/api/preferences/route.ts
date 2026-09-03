import { NextResponse } from "next/server";

import { deletePersonal, getPreferences, patchPersonal } from "@/lib/preferences/handlers";
import { preferenceContext, readBody, toResponse } from "./context";

export async function GET(): Promise<NextResponse> {
  const context = await preferenceContext();
  if (context instanceof NextResponse) return context;

  return toResponse(await getPreferences(context.repository, context.scope));
}

/** Bežný zápis z appky — vždy OSOBNÁ úroveň. Firemnú mení len `PUT /api/preferences/tenant`. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const context = await preferenceContext();
  if (context instanceof NextResponse) return context;

  return toResponse(await patchPersonal(context.repository, context.scope, await readBody(request)));
}

/** „Vrátiť sa na firemné" — zmaže osobné prepísanie vymenovaných kľúčov. */
export async function DELETE(request: Request): Promise<NextResponse> {
  const context = await preferenceContext();
  if (context instanceof NextResponse) return context;

  return toResponse(await deletePersonal(context.repository, context.scope, await readBody(request)));
}
