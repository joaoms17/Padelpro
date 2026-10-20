import { describe, it, expect } from "vitest";
import {
  parseDelimited,
  detectTable,
  parseDateToISO,
  computeExternalId,
  buildImport,
  matchBankCovered,
} from "./import";

const SANTANDER_CSV = `Conta: PT50 0000 ...
Saldo: 1.234,56 €

Data Movimento;Descrição;Débito;Crédito
05/01/2026;COMPRA CONTINENTE LISBOA;45,20;
06/01/2026;TRF RENDA CASA;;650,00
06/01/2026;PAG. EDP ENERGIA;62,10;
07/01/2026;COMPRA CONTINENTE LISBOA;45,20;
`;

describe("parseDelimited", () => {
  it("detects the ; delimiter and strips BOM/empty lines", () => {
    const rows = parseDelimited("﻿a;b;c\n\n1;2;3\n");
    expect(rows).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });
});

describe("detectTable", () => {
  it("finds the header row past the preamble and maps split columns", () => {
    const rows = parseDelimited(SANTANDER_CSV);
    const det = detectTable(rows);
    expect(det).not.toBeNull();
    expect(det!.headerIndex).toBe(2); // after the 2 preamble lines
    expect(det!.mapping.amountMode).toBe("split");
    expect(det!.mapping.dateCol).toBe(0);
    expect(det!.mapping.descCol).toBe(1);
  });
});

describe("parseDateToISO", () => {
  it("handles dd/mm/yyyy and yyyy-mm-dd", () => {
    expect(parseDateToISO("05/01/2026")).toBe("2026-01-05");
    expect(parseDateToISO("2026-01-05", "ymd")).toBe("2026-01-05");
    expect(parseDateToISO("lixo")).toBeNull();
  });
});

describe("buildImport dedup", () => {
  const rows = parseDelimited(SANTANDER_CSV);
  const { headerIndex, mapping } = detectTable(rows)!;

  it("parses amounts with correct signs (credit +, debit -)", () => {
    const { items } = buildImport(rows, mapping, headerIndex + 1);
    const renda = items.find((i) => i.description_raw.includes("RENDA"));
    const compra = items.find((i) => i.description_raw.includes("CONTINENTE"));
    expect(renda!.amount_cents).toBe(65000);
    expect(compra!.amount_cents).toBe(-4520);
  });

  it("keeps genuine same-day/same-amount repeats distinct via seq", () => {
    const { items } = buildImport(rows, mapping, headerIndex + 1);
    const continente = items.filter((i) =>
      i.description_raw.includes("CONTINENTE"),
    );
    expect(continente).toHaveLength(2);
    expect(continente[0].external_id).not.toBe(continente[1].external_id);
  });

  it("re-importing the same statement yields identical external_ids (no dupes)", () => {
    const a = buildImport(rows, mapping, headerIndex + 1);
    const b = buildImport(parseDelimited(SANTANDER_CSV), mapping, headerIndex + 1);
    expect(a.items.map((i) => i.external_id)).toEqual(
      b.items.map((i) => i.external_id),
    );
  });

  it("an overlapping statement dedups the shared rows", () => {
    const first = buildImport(rows, mapping, headerIndex + 1);
    // a second file that repeats two of the same rows plus one new row
    const overlap = parseDelimited(
      `Data Movimento;Descrição;Débito;Crédito
06/01/2026;TRF RENDA CASA;;650,00
07/01/2026;COMPRA CONTINENTE LISBOA;45,20;
10/01/2026;NOVA COMPRA;10,00;
`,
    );
    const det2 = detectTable(overlap)!;
    const second = buildImport(overlap, det2.mapping, det2.headerIndex + 1);

    const existing = new Set(first.items.map((i) => i.external_id));
    const novos = second.items.filter((i) => !existing.has(i.external_id));
    expect(novos).toHaveLength(1);
    expect(novos[0].description_raw).toBe("NOVA COMPRA");
  });
});

describe("computeExternalId", () => {
  it("is stable and ignores punctuation/case in remittance", () => {
    const a = computeExternalId("2026-01-05", -4520, "COMPRA  CONTINENTE!", 0);
    const b = computeExternalId("2026-01-05", -4520, "compra continente", 0);
    expect(a).toBe(b);
  });
});

describe("matchBankCovered", () => {
  const row = (d: string, c: number) => ({ booking_date: d, amount_cents: c });
  it("skips statement rows the bank already has (same amount, ±3 days)", () => {
    const items = [row("2026-07-20", -1250), row("2026-07-21", -4000), row("2026-05-02", -900)];
    const bank = [row("2026-07-22", -1250), row("2026-07-21", -4000)];
    const covered = matchBankCovered(items, bank);
    expect([...covered]).toEqual([items[0], items[1]]);
  });
  it("keeps two identical purchases when the bank has only one", () => {
    const items = [row("2026-08-01", -150), row("2026-08-01", -150)];
    expect(matchBankCovered(items, [row("2026-08-01", -150)]).size).toBe(1);
  });
  it("does not match beyond the window or on a different amount", () => {
    const items = [row("2026-08-01", -150)];
    expect(matchBankCovered(items, [row("2026-08-06", -150), row("2026-08-01", -151)]).size).toBe(0);
  });
  it("fills a gap after the bank link lapsed (no bank rows there)", () => {
    const items = [row("2027-05-10", -3000)];
    expect(matchBankCovered(items, [row("2026-10-01", -3000)]).size).toBe(0);
  });
});
