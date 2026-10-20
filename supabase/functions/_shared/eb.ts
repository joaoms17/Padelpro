// Enable Banking API client for Deno Edge Functions.
// Auth: RS256 JWT with kid = Application ID (spec 4.1).
import { SignJWT, importPKCS8 } from "npm:jose@5.9.6";
import { normalizePem } from "./pem.ts";

const EB_BASE = "https://api.enablebanking.com";

export interface ASPSP {
  name: string;
  country: string;
  maximum_consent_validity?: number; // seconds
}

let cachedJwt: { token: string; exp: number } | null = null;

async function makeJwt(): Promise<string> {
  const appId = Deno.env.get("EB_APP_ID");
  const pem = Deno.env.get("EB_PRIVATE_KEY");
  if (!appId || !pem) {
    throw new Error("EB_APP_ID / EB_PRIVATE_KEY não configurados nos secrets.");
  }
  const now = Math.floor(Date.now() / 1000);
  if (cachedJwt && cachedJwt.exp - 60 > now) return cachedJwt.token;

  // Accepts PKCS#8/PKCS#1, literal \n, one-line or base64 secrets.
  const key = await importPKCS8(normalizePem(pem), "RS256");
  const exp = now + 3600; // 1h (max 24h)
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "RS256", kid: appId, typ: "JWT" })
    .setIssuer("enablebanking.com")
    .setAudience("api.enablebanking.com")
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(key);

  cachedJwt = { token, exp };
  return token;
}

export async function ebFetch<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = await makeJwt();
  const res = await fetch(`${EB_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Enable Banking ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** Find the Santander ASPSP in Portugal (never hardcode the exact name). */
export async function findSantanderPT(): Promise<ASPSP> {
  const data = await ebFetch<{ aspsps: ASPSP[] }>("/aspsps?country=PT");
  const santander = (data.aspsps ?? []).find((a) =>
    a.name.toLowerCase().includes("santander"),
  );
  if (!santander) throw new Error("Santander não encontrado na lista de ASPSPs (PT).");
  return santander;
}
