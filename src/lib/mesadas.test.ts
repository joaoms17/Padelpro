import { describe, it, expect } from "vitest";
import { mesadaFor, takenByMember } from "./mesadas";

const joao = { id: "j", display_name: "João", mesada_cents: 30000 };
const joana = { id: "a", display_name: "Joana", mesada_cents: 25000 };

describe("mesadas", () => {
  it("a month's own value wins over the base", () => {
    const o = [{ member_id: "j", month: "2026-12-01", amount_cents: 40000 }];
    expect(mesadaFor(joao, "2026-12", o)).toBe(40000);
    expect(mesadaFor(joao, "2026-11", o)).toBe(30000);
  });
  it("what each one took, from their own mesada category", () => {
    const cats = [
      { id: "mj", grp: "mesada" as const, name: "Mesada João" },
      { id: "ma", grp: "mesada" as const, name: "Mesada Joana" },
    ];
    const tx = [
      { category_id: "mj", amount_cents: -30000, booking_date: "2026-12-05" },
      { category_id: "mj", amount_cents: -5000, booking_date: "2026-12-20" },
      { category_id: "ma", amount_cents: -25000, booking_date: "2026-12-05" },
      { category_id: null, amount_cents: -999, booking_date: "2026-12-05" },
    ];
    const t = takenByMember(tx, cats, [joao, joana]);
    expect(t.get("j")!.get("2026-12")).toBe(35000);
    expect(t.get("a")!.get("2026-12")).toBe(25000);
  });
});
