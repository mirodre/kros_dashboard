export const SESSION_COOKIE_NAME = "kros_dashboard_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function readEnv(name: string) {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : undefined;
}

function getAuthSecret() {
  const secret = readEnv("AUTH_SECRET");
  if (!secret || secret.length < 32) {
    return null;
  }
  return secret;
}

function timingSafeEqualText(a: string, b: string) {
  if (a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) {
    mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return mismatch === 0;
}

export function isAuthConfigured() {
  const password = readEnv("DASHBOARD_PASSWORD");
  return Boolean(getAuthSecret() && password && password.length >= 8);
}

async function signPayload(payload: string) {
  const secret = getAuthSecret();
  if (!secret) {
    throw new Error("AUTH_SECRET is not configured");
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Buffer.from(signature).toString("base64url");
}

export async function createSessionToken() {
  const expiresAt = Date.now() + SESSION_MAX_AGE_SECONDS * 1000;
  const payload = String(expiresAt);
  return `${payload}.${await signPayload(payload)}`;
}

export async function verifySessionToken(token: string | undefined) {
  if (!token || !isAuthConfigured()) {
    return false;
  }

  const [payload, signature] = token.split(".");
  if (!payload || !signature) {
    return false;
  }

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return false;
  }

  let expectedSignature: string;
  try {
    expectedSignature = await signPayload(payload);
  } catch {
    return false;
  }

  return timingSafeEqualText(signature, expectedSignature);
}

export function verifyDashboardPassword(password: string) {
  const expected = readEnv("DASHBOARD_PASSWORD");
  if (!expected) {
    return false;
  }

  return timingSafeEqualText(password.trim(), expected);
}

export function getSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS
  };
}
