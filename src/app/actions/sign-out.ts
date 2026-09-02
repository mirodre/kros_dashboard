"use server";

import { signOut } from "@/auth";
import { serviceSignOutUrl } from "@/lib/sign-out-url";

export async function signOutAction(): Promise<void> {
  // `redirectTo` vedie do služby, nie na stránku appky: session musí zaniknúť na oboch
  // stranách, inak by ďalšie kliknutie na „Prihlásiť sa" ticho prihlásilo toho istého
  // človeka späť.
  await signOut({ redirectTo: serviceSignOutUrl() });
}
