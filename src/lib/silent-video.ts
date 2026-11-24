// Balík nemá typy pre vnútorný súbor s médiami — deklarácia je v `nosleep-media.d.ts`.
import { mp4 } from "nosleep.js/src/media.js";

/**
 * Krátke tiché video (čierna plocha s tichou zvukovou stopou). Kým na iOS hrá,
 * displej sa nezamkne — viď `screen-wake-lock.ts`.
 *
 * Berieme len samotné video z NoSleep.js, nie jeho logiku: tá pri dostupnom
 * Wake Lock API video vôbec nepoužije, a práve to na iOS potrebujeme.
 */
export const SILENT_VIDEO_MP4: string = mp4;
