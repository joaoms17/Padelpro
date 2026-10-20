// Normalises the Enable Banking private key into a PKCS#8 PEM that jose's
// importPKCS8 accepts, whatever way it was pasted into the secrets:
//   • real newlines, literal "\n", CRLF, or everything on one line
//   • the whole PEM base64-encoded once more
//   • PKCS#1 ("BEGIN RSA PRIVATE KEY"), which is re-wrapped as PKCS#8
// Pure (no Deno APIs) so it is unit-tested with vitest.

const PEM_RE = /-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/;

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

export function normalizePem(raw: string): string {
  let text = raw.trim().replace(/^["']|["']$/g, "").replace(/\\r/g, "").replace(/\\n/g, "\n");

  // The whole PEM may itself be base64-encoded (handy for single-line secrets).
  if (!text.includes("-----BEGIN")) {
    try {
      const decoded = new TextDecoder().decode(b64ToBytes(text.replace(/\s+/g, "")));
      if (decoded.includes("-----BEGIN")) text = decoded;
    } catch (_e) {
      /* not base64 — fall through to the error below */
    }
  }

  const m = PEM_RE.exec(text);
  if (!m) throw new Error("EB_PRIVATE_KEY não é uma chave PEM válida.");
  const label = m[1].trim();
  const der = b64ToBytes(m[2].replace(/[^A-Za-z0-9+/=]/g, ""));

  if (label === "PRIVATE KEY") return toPem("PRIVATE KEY", der);
  if (label === "RSA PRIVATE KEY") return toPem("PRIVATE KEY", pkcs1ToPkcs8(der));
  throw new Error(`EB_PRIVATE_KEY: tipo de chave não suportado (${label}).`);
}
