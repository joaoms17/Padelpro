import { describe, it, expect } from "vitest";
import { makePaidOut, mesadaFor, takenByMember } from "./mesadas";

const joao = { id: "j", display_name: "João", mesada_cents: 30000 };
const joana = { id: "a", display_name: "Joana", mesada_cents: 25000 };
const cats = [
  { id: "mj", grp: "mesada" as const, name: "Mesada João" },
  { id: "ma", grp: "mesada" as const, name: "Mesada Joana" },
  { id: "int", grp: "interna" as const, name: "Entre contas" },
  { id: "sup", grp: "variavel" as const, name: "Supermercado" },
];

describe("mesadas", () => {
  it("a month's own value wins over the base", () => {
    const o = [{ member_id: "j", month: "2026-12-01", amount_cents: 40000 }];
    expect(mesadaFor(joao, "2026-12", o)).toBe(40000);
    expect(mesadaFor(joao, "2026-11", o)).toBe(30000);
  });
  it("transfers to each of you count by category or by name in the description", () => {
    const paid = makePaidOut(cats, [joao, joana]);
    const tx = [
      { category_id: null, amount_cents: -50000, booking_date: "2026-08-01", description_raw: "TRF P/ JOAO M SILVA" },
      { category_id: "int", amount_cents: -764388, booking_date: "2026-08-25", description_raw: "TRANSF JOAO PREMIO" },
      { category_id: "ma", amount_cents: -25000, booking_date: "2026-08-05", description_raw: "MESADA" },
      { category_id: null, amount_cents: -10000, booking_date: "2026-08-06", description_raw: "TRF PARA JOANA CARNEIRO" },
      { category_id: "sup", amount_cents: -3000, booking_date: "2026-08-07", description_raw: "PADARIA SAO JOAO" },
      { category_id: null, amount_cents: -1500, booking_date: "2026-08-07", description_raw: "CONTINENTE" },
      { category_id: null, amount_cents: 50000, booking_date: "2026-08-07", description_raw: "TRF DE JOANA" },
    ];
    expect(tx.map((t) => paid(t))).toEqual([
      { paid: true, member: "j" },
      { paid: true, member: "j" },
      { paid: true, member: "a" },
      { paid: true, member: "a" },
      { paid: false, member: null },
      { paid: false, member: null },
      { paid: false, member: null },
    ]);
    const t = takenByMember(tx, paid, [joao, joana]);
    expect(t.get("j")!.get("2026-08")!.cents).toBe(814388);
    expect(t.get("a")!.get("2026-08")!.cents).toBe(35000);
  });
});
