"use server";

import { redirect } from "next/navigation";

import { signOut } from "@/auth";
import { serviceSignOutUrl } from "@/lib/sign-out-url";

export async function signOutAction(): Promise<void> {
  // Session musí zaniknúť na oboch stranách, inak by ďalšie kliknutie na „Prihlásiť sa"
  // ticho prihlásilo toho istého človeka späť — presne zlyhanie `payment_connectora`, kým
  // sa `?app=` neposielal.
  //
  // `signOut({ redirectTo })` sem nestačí: Auth.js defaultný `redirect` callback zahodí
  // cieľ na inom origine než appka a nahradí ho vlastnou base URL appky (over. priamo
  // v `@auth/core/lib/init.js`), takže by človek nikdy nedošiel do `/logout` v službe
  // a session by tam ostala živá. Vlastný `redirect` callback v `src/auth.ts` nie je
  // riešenie — tá istá ochrana pred open-redirectom sa spolieha na default všade inde,
  // kde `callbackUrl` prichádza od klienta (napr. middleware ho skladá z cesty requestu).
  // Preto appka najprv zruší LEN lokálnu session (`redirect: false`) a cross-origin skok
  // do služby urobí sama, cez `redirect()` z `next/navigation`, ktorý žiadny allowlist
  // originu nemá.
  await signOut({ redirect: false });

  // `redirect()` funguje tak, že hodí riadiacu výnimku — nesmie byť v try/catch a nič
  // za ňou nesmie bežať, inak by presmerovanie nikdy neprebehlo.
  redirect(serviceSignOutUrl());
}
