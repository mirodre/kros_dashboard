import type { DocumentPaymentStatus } from "./kros-types";

/**
 * Kódy stavu úhrady z KROS API. Vzorka odpovedí potvrdila, že faktúry aj výdavky
 * používajú to isté číselníkovanie, preto mapa žije mimo oboch modulov —
 * dve kópie by sa časom rozišli.
 */
export const PAYMENT_STATUS_BY_CODE: Record<number, DocumentPaymentStatus> = {
  0: "notPaid",
  1: "fullyPaid",
  2: "overPaid",
  3: "partiallyPaid",
  [-1]: "undefined"
};
