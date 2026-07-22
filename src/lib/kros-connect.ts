import { savePendingState } from "./kros-storage";

function createIntegrationConsentUrl(state: string) {
  const consentBase =
    process.env.NEXT_PUBLIC_KROS_CONSENT_BASE_URL ?? "https://firma.kros.sk/integration-consent";
  const appBaseUrl = window.location.origin;
  const params = new URLSearchParams({
    plugin_name: "KrosDashboard",
    integrator_name: "KrosDashboard",
    version: "1",
    response_mode: "post",
    redirect_url: `${appBaseUrl}/kros/callback`,
    state,
    company_mode: "multiple"
  });
  return `${consentBase}?${params.toString()}`;
}

type StartKrosConnectOptions = {
  onStatus?: (message: string) => void;
};

/**
 * Spustí bezpečné OAuth prepojenie s KROS: pripraví state na serveri a presmeruje
 * používateľa na KROS integration consent. Vracia false, ak sa prípravu nepodarilo
 * dokončiť (presmerovanie neprebehne).
 */
export async function startKrosConnect(options: StartKrosConnectOptions = {}): Promise<boolean> {
  const { onStatus } = options;
  const state = crypto.randomUUID().replace(/-/g, "");
  savePendingState(state);
  onStatus?.("Pripravujem bezpečné prepojenie s KROS...");

  try {
    const response = await fetch("/api/kros/oauth-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    if (!response.ok) {
      onStatus?.("Nepodarilo sa pripraviť OAuth prepojenie. Skús to znova.");
      return false;
    }
  } catch {
    onStatus?.("Nepodarilo sa kontaktovať server. Skús to znova.");
    return false;
  }

  onStatus?.("Presmerovávam do KROS prepojenia...");
  window.location.assign(createIntegrationConsentUrl(state));
  return true;
}
