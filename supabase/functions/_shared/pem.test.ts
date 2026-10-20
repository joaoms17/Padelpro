import { describe, it, expect } from "vitest";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { normalizePem, parsePrivateKey } from "./pem";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

/** Same key material, regardless of how the PEM was mangled. */
function sameKey(pem: string) {
  const k = createPrivateKey(pem);
  return k.export({ type: "pkcs8", format: "pem" }).toString() === pkcs8;
}

describe("normalizePem", () => {
  it("keeps a clean PKCS#8 PEM intact", () => {
    expect(normalizePem(pkcs8)).toBe(pkcs8);
  });
  it("restores literal \\n and CRLF", () => {
    expect(normalizePem(pkcs8.replace(/\n/g, "\\n"))).toBe(pkcs8);
    expect(normalizePem(pkcs8.replace(/\n/g, "\r\n"))).toBe(pkcs8);
  });
  it("accepts a PEM collapsed onto one line, quoted", () => {
    expect(normalizePem(`"${pkcs8.replace(/\n/g, " ")}"`)).toBe(pkcs8);
  });
  it("accepts a base64-encoded PEM", () => {
    expect(normalizePem(Buffer.from(pkcs8).toString("base64"))).toBe(pkcs8);
  });
  it("re-wraps PKCS#1 as PKCS#8", () => {
    const out = normalizePem(pkcs1);
    expect(out.startsWith("-----BEGIN PRIVATE KEY-----")).toBe(true);
    expect(sameKey(out)).toBe(true);
    expect(out).toBe(pkcs8);
  });
  it("accepts bare base64 DER without BEGIN/END lines (PKCS#8 and PKCS#1)", () => {
    const der8 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
    const der1 = privateKey.export({ type: "pkcs1", format: "der" }).toString("base64");
    expect(normalizePem(der8)).toBe(pkcs8);
    expect(normalizePem(der1)).toBe(pkcs8);
    // ...also wrapped over lines, as a file would be
    expect(normalizePem(der8.match(/.{1,64}/g)!.join("\n"))).toBe(pkcs8);
  });
  it("repairs typographic dashes and odd dash counts", () => {
    expect(normalizePem(pkcs8.replace(/-----/g, "\u2014\u2014-"))).toBe(pkcs8);
    expect(normalizePem(pkcs8.replace(/-----/g, "---"))).toBe(pkcs8);
  });
  it("returns a JWK as such", () => {
    const jwk = privateKey.export({ format: "jwk" });
    const parsed = parsePrivateKey(JSON.stringify(jwk));
    expect(parsed.kind).toBe("jwk");
  });
  it("explains what is wrong without echoing the key", () => {
    const truncated = pkcs8.split("\n").slice(0, 10).join("\n");
    expect(() => normalizePem(truncated)).toThrow(/falta a linha END/);
    expect(() => normalizePem("3f2a9c1e-0000-1111-2222-333344445555")).toThrow(/sem linha BEGIN/);
    try {
      normalizePem(truncated);
    } catch (e) {
      expect((e as Error).message).not.toContain(truncated.split("\n")[3]);
    }
  });
  it("points out a certificate or encrypted key", () => {
    const cert = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
    expect(() => normalizePem(cert)).toThrow(/PRIVADA/);
    const enc = "-----BEGIN ENCRYPTED PRIVATE KEY-----\nMIIB\n-----END ENCRYPTED PRIVATE KEY-----";
    expect(() => normalizePem(enc)).toThrow(/password/);
  });
  it("rejects garbage and public keys", () => {
    expect(() => normalizePem("not a key")).toThrow();
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => normalizePem(pub)).toThrow(/não suportado/);
  });
});
