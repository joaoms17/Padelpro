// Turns the Enable Banking private key, however it was pasted into the
// secrets, into something jose can import:
//   • PEM with real newlines, literal "\n", CRLF, or everything on one line
//   • typographic dashes (— –) that some editors put in place of "-----"
//   • the whole PEM base64-encoded once more
//   • bare base64 DER without the BEGIN/END lines
//   • PKCS#1 ("BEGIN RSA PRIVATE KEY" or DER), re-wrapped as PKCS#8
//   • a JWK (JSON with "kty"), imported as such
// When nothing fits, the error describes what was found (length, lines,
// header) without ever echoing key material.
// Pure (no Deno APIs) so it is unit-tested with vitest.

const PEM_RE = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/;

export type PrivateKeyInput =
  | { kind: "pem"; pem: string }
  | { kind: "jwk"; jwk: Record<string, unknown> };

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** DER length octets (short form < 128, long form otherwise). */
function derLength(n: number): number[] {
  if (n < 0x80) return [n];
  const out: number[] = [];
  while (n > 0) {
    out.unshift(n & 0xff);
    n >>= 8;
  }
  return [0x80 | out.length, ...out];
}

// AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }
const RSA_ALG_ID = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];

/** Wraps a PKCS#1 RSAPrivateKey (DER) into a PKCS#8 PrivateKeyInfo (DER). */
export function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const octet = [0x04, ...derLength(pkcs1.length)];
  const inner = [0x02, 0x01, 0x00, ...RSA_ALG_ID, ...octet];
  const total = inner.length + pkcs1.length;
  const out = new Uint8Array(1 + derLength(total).length + total);
  out.set([0x30, ...derLength(total), ...inner], 0);
  out.set(pkcs1, out.length - pkcs1.length);
  return out;
}

function toPem(label: string, der: Uint8Array): string {
  const lines = bytesToB64(der).match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/**
 * A private key in DER: SEQUENCE { INTEGER 0, … }. After the version,
 * PKCS#8 continues with the AlgorithmIdentifier SEQUENCE (0x30) and PKCS#1
 * with the modulus INTEGER (0x02).
 */
function derKind(der: Uint8Array): "pkcs8" | "pkcs1" | null {
  if (der.length < 16 || der[0] !== 0x30) return null;
  let i = 1;
  i += der[i] & 0x80 ? 1 + (der[i] & 0x7f) : 1; // skip the SEQUENCE length
  if (der[i] !== 0x02 || der[i + 1] !== 0x01 || der[i + 2] !== 0x00) return null; // version 0
  const next = der[i + 3];
  return next === 0x30 ? "pkcs8" : next === 0x02 ? "pkcs1" : null;
}

function fromDer(der: Uint8Array): string | null {
  const kind = derKind(der);
  if (kind === "pkcs8") return toPem("PRIVATE KEY", der);
  if (kind === "pkcs1") return toPem("PRIVATE KEY", pkcs1ToPkcs8(der));
  return null;
}

function tryBase64(text: string): Uint8Array | null {
  const compact = text.replace(/\s+/g, "");
  if (!compact || !/^[A-Za-z0-9+/=_-]+$/.test(compact)) return null;
  try {
    return b64ToBytes(compact.replace(/-/g, "+").replace(/_/g, "/"));
  } catch (_e) {
    return null;
  }
}

/** What the value looks like, without revealing it. */
function describe(text: string): string {
  const lines = text.split("\n").filter((l) => l.trim()).length;
  const header = /-----BEGIN ([A-Z ]+)-----/.exec(text)?.[1];
  const hints = [
    `${text.length} caracteres`,
    `${lines} linha(s)`,
    header ? `cabeçalho "BEGIN ${header}"` : "sem linha BEGIN",
  ];
  if (header && !/-----END /.test(text)) hints.push("falta a linha END (cópia incompleta?)");
  return hints.join(", ");
}

export function parsePrivateKey(raw: string): PrivateKeyInput {
  let text = raw
    .replace(/^﻿/, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\\r/g, "")
    .replace(/\\n/g, "\n")
    // Editors that "prettify" dashes turn ----- into — or –.
    .replace(/[‐-―−]/g, (d) => (d === "—" || d === "―" ? "--" : "-"))
    .replace(/\r/g, "");

  // JWK (e.g. a key exported from SubtleCrypto as JSON).
  if (text.startsWith("{")) {
    try {
      const jwk = JSON.parse(text) as Record<string, unknown>;
      if (jwk.kty === "RSA" && jwk.d) return { kind: "jwk", jwk };
      throw new Error("not an RSA private JWK");
    } catch (_e) {
      throw new Error(`EB_PRIVATE_KEY parece JSON mas não é uma chave privada RSA (${describe(text)}).`);
    }
  }

  // Some tools put a different number of dashes around the labels.
  text = text.replace(/-{3,}\s*(BEGIN|END) ([A-Z ]+?)\s*-{3,}/g, "-----$1 $2-----");

  // The whole PEM may itself be base64-encoded (handy for single-line secrets).
  if (!text.includes("-----BEGIN")) {
    const bytes = tryBase64(text);
    if (bytes) {
      const asText = new TextDecoder().decode(bytes);
      if (asText.includes("-----BEGIN")) text = asText.trim();
      else {
        // Or it is the bare key itself (DER, base64) without BEGIN/END lines.
        const pem = fromDer(bytes);
        if (pem) return { kind: "pem", pem };
      }
    }
  }

  const m = PEM_RE.exec(text);
  if (!m) throw new Error(`EB_PRIVATE_KEY não é uma chave PEM válida (${describe(text)}).`);
  const label = m[1].trim();
  const body = m[2].replace(/^[A-Za-z-]+:.*$/gm, ""); // drop "Proc-Type:"-style headers
  if (label === "ENCRYPTED PRIVATE KEY" || /ENCRYPTED/.test(m[2])) {
    throw new Error("EB_PRIVATE_KEY está protegida por password — exporta-a sem password.");
  }
  if (label !== "PRIVATE KEY" && label !== "RSA PRIVATE KEY") {
    throw new Error(
      `EB_PRIVATE_KEY: tipo de chave não suportado (${label}) — é preciso a chave PRIVADA, não o certificado/chave pública.`,
    );
  }
  const der = b64ToBytes(body.replace(/[^A-Za-z0-9+/=]/g, ""));
  if (label === "RSA PRIVATE KEY") return { kind: "pem", pem: toPem("PRIVATE KEY", pkcs1ToPkcs8(der)) };
  return { kind: "pem", pem: toPem("PRIVATE KEY", der) };
}

/** PKCS#8 PEM for jose's importPKCS8 (throws for JWK input — use parsePrivateKey). */
export function normalizePem(raw: string): string {
  const parsed = parsePrivateKey(raw);
  if (parsed.kind !== "pem") throw new Error("EB_PRIVATE_KEY é um JWK — usa parsePrivateKey.");
  return parsed.pem;
}
