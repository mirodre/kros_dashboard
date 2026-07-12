# Cloudflare „loader“ pred KROS Dashboard (Dokploy)

Tento návod nastaví ochranu typu **„Checking your browser…“** cez [Cloudflare](https://www.cloudflare.com/) pred tvojou aplikáciou v Dokploy. Funguje na úrovni DNS/proxy — **netreba meniť kód** v repozitári.

Loader **nenahrádza** env heslo (`DASHBOARD_PASSWORD`). Odporúčané je mať **oboje**:

1. Cloudflare — odfiltruje botov a automatické skenery  
2. Heslo v appke — pustí len tých, čo ho poznajú  

---

## Čo budeš potrebovať

- Doménu (napr. `dashboard.tvojafirma.sk`)
- Účet Cloudflare (bezplatný plán stačí)
- Dokploy aplikáciu s nasadeným `kros_dashboard` a funkčným HTTPS na tej doméne
- IP adresu servera, kde beží Dokploy

---

## Krok 1: Doména v Dokploy

1. V Dokploy otvor aplikáciu **kros_dashboard**.
2. V záložke **Domains** pridaj doménu, napr. `dashboard.tvojafirma.sk`, zapni **HTTPS** (certifikát vystaví Traefik cez Let's Encrypt).
3. Uisti sa, že deploy beží a stránka ide priamo (bez Cloudflare), aspoň na `/login`.
4. V env v Dokploy (**Environment**) už máš `AUTH_SECRET` a `DASHBOARD_PASSWORD`.

Poznač si **verejnú IP** servera, kde beží Dokploy (z `A` záznamu u registrátora alebo zo servera).

---

## Krok 2: Doména v Cloudflare

1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Add a site** → zadaj doménu (`tvojafirma.sk` alebo subdoménu podľa toho, čo používaš).
2. Vyber **Free** plán.
3. Cloudflare ukáže **nameservery** (napr. `ada.ns.cloudflare.com`) — u registrátora domény zmeň NS na tieto hodnoty (môže trvať hodiny, často do 30 min).

---

## Krok 3: DNS záznam (oranžový obláčik = loader zapnutý)

V Cloudflare → **DNS** → **Records**:

| Typ | Meno | Obsah | Proxy |
|-----|------|--------|-------|
| `A` | `dashboard` (alebo `@`) | IP tvojho Dokploy servera | **Proxied** (oranžový obláčik) |

- **Proxied = zapnuté** — traffic ide cez Cloudflare (tu vzniká loader a ochrana botov).
- **DNS only (šedý)** — Cloudflare loader **nebude**, len DNS.

---

## Krok 4: SSL (HTTPS)

Cloudflare → **SSL/TLS**:

1. Režim: **Full (strict)** (ak Traefik v Dokploy má platný Let's Encrypt certifikát na doméne — bežný prípad).
2. Ak by stránka nešla, skús dočasne **Full**, potom späť na **strict** po vyriešení certu v Dokploy.

Pozn.: Let's Encrypt používa HTTP-01 validáciu — ak by obnova certu cez Cloudflare proxy zlyhávala, dočasne prepni záznam na **DNS only**, nechaj cert obnoviť a proxy zapni späť.

---

## Krok 5: Zapnutie loadera / ochrany botov

Cloudflare → **Security** (alebo **Security Settings**):

### Odporúčané na bežné používanie

- **Security Level**: `Medium` alebo `High`
- **Bots** → **Bot Fight Mode**: **On** (na Free pláne často dostupné)  
  - Jemná ochrana, občas krátka kontrola.

### Agresívny loader (ako „Just a moment…“ na každého)

- **I'm Under Attack Mode**: **On**  
  - Silný loader pre všetkých návštevníkov — vhodné skôr pri útoku alebo na pár dní, nie na dennú prácu účtovníka.

### Voliteľné

- **Security** → **Settings** → **Browser Integrity Check**: On  
- **WAF** (ak máš): základné pravidlá podľa potreby  

Po uložení otvor doménu v **anonymnom okne** — mal by si vidieť krátku Cloudflare stránku, potom `/login` tvojej appky.

---

## Krok 6: KROS prepojenie (dôležité)

V appke sa pri prepojení používa `redirect_url` = `https://tvoja-doména/kros/callback`.

Po zapnutí Cloudflare musí byť v KROS consent flow **tá istá verejná HTTPS doména** ako v Dokploy (nie IP, nie stará doména).

Ak si menil doménu, znova **Prepojiť s KROS** v Nastaveniach.

---

## Overenie, že to funguje

1. Anonymné okno → `https://dashboard.tvojafirma.sk`  
   - najprv (podľa režimu) Cloudflare kontrola,  
   - potom login appky,  
   - po hesle dashboard.
2. V Cloudflare → **Security** → **Events** — uvidíš požiadavky a blokované boty.
3. `curl` bez browsera často dostane **403** alebo challenge — to je očakávané (bot filter).

---

## Časté problémy

| Problém | Riešenie |
|---------|----------|
| Slučka redirectov | SSL režim zmeniť na Full (strict); skontrolovať doménu v Dokploy |
| 502 / Bad Gateway | A záznam smeruje na správnu IP; kontajner v Dokploy beží |
| Loader navždy, appka nenačíta | Vypni **Under Attack**; nechaj len Bot Fight Mode |
| KROS callback zlyhá | Doména v Dokploy = doména v prehliadači; HTTPS; znova prepojiť KROS |
| Lokálne `localhost` | Cloudflare sa na localhost neaplikuje — len produkčná doména |

---

## Súhrn

| Vrstva | Chráni pred |
|--------|-------------|
| Cloudflare loader | Botmi, skenermi, časťou DDoS |
| `DASHBOARD_PASSWORD` | Ľuďmi, čo nevidia heslo |
| Tokeny v `localStorage` | Ani jedno plne — na to treba tokeny na serveri |

Ak chceš, v ďalšom kroku môžeme pridať **Cloudflare Turnstile** priamo na stránku `/login` (viditeľná kontrola len pri prihlásení) — to už vyžaduje `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` v env.
