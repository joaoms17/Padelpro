import { describe, it, expect } from "vitest";
import { proposeSettlement, type Pending } from "./settle";

const pending: Pending[] = [
  { id: "a", amount_cents: 5000, received_at: "2026-04-01" },
  { id: "b", amount_cents: 15000, received_at: "2026-04-10" },
  { id: "c", amount_cents: 3000, received_at: "2026-04-05" },
];

describe("proposeSettlement", () => {
  it("matches a single payment exactly", () => {
    expect(proposeSettlement(pending, 15000).map((p) => p.id)).toEqual(["b"]);
  });
  it("accumulates oldest-first to the exact sum", () => {
    expect(proposeSettlement(pending, 8000).map((p) => p.id).sort()).toEqual(["a", "c"]);
  });
  it("returns nothing when no combination matches", () => {
    expect(proposeSettlement(pending, 9999)).toEqual([]);
    expect(proposeSettlement(pending, 0)).toEqual([]);
  });
});
