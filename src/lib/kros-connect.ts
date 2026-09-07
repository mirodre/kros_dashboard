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
  // `state` sa neukladá v prehliadači: od fázy 2 ho server viaže na firmu a človeka pri
  // vydaní, takže návrat z KROS overuje on — nie kód, ktorý beží na zariadení.
  onStatus?.("Pripravujem bezpečné prepojenie s KROS...");

  try {
    const response = await fetch("/api/kros/oauth-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state })
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      onStatus?.(payload?.error ?? "Nepodarilo sa pripraviť OAuth prepojenie. Skús to znova.");
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
