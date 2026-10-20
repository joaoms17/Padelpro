import { describe, it, expect } from "vitest";
import { createPrivateKey, generateKeyPairSync } from "node:crypto";
import { normalizePem } from "./pem";

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
  it("rejects garbage and public keys", () => {
    expect(() => normalizePem("not a key")).toThrow();
    const pub = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(() => normalizePem(pub)).toThrow(/não suportado/);
  });
});
