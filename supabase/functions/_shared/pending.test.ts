import { describe, it, expect } from "vitest";
import { findStale, candidateIds, planPending, type StoredPending, type ReturnedRow } from "./pending";

const p = (id: string, amount: number, date: string, ext = `h:${id}`): StoredPending => ({
  id,
  external_id: ext,
  amount_cents: amount,
  booking_date: date,
});
const r = (ext: string, amount: number, date: string, status: ReturnedRow["status"] = "confirmado"): ReturnedRow => ({
  external_id: ext,
  amount_cents: amount,
  booking_date: date,
  status,
});

describe("findStale", () => {
  it("keeps only rows in the window that the bank stopped returning", () => {
    const pending = [p("a", -500, "2026-03-10"), p("b", -700, "2026-03-11"), p("c", -900, "2026-02-01")];
    const stale = findStale(pending, new Set(["h:b"]), "2026-03-01");
    expect(stale.map((s) => s.id)).toEqual(["a"]);
  });
});

describe("planPending", () => {
  it("re-points a pending row to its booked version (same amount, a day later)", () => {
    const stale = [p("a", -4520, "2026-03-10")];
    const returned = [r("ref:E1", -4520, "2026-03-11"), r("ref:E2", -1000, "2026-03-11")];
    expect(candidateIds(stale, returned)).toEqual(["ref:E1"]);
    const plan = planPending(stale, returned, new Set(), "2026-03-12");
    expect(plan).toEqual({ relink: [{ id: "a", external_id: "ref:E1" }], remove: [] });
  });

  it("never claims a movement that is already stored", () => {
    const stale = [p("a", -4520, "2026-03-10")];
    const returned = [r("ref:E1", -4520, "2026-03-11")];
    const plan = planPending(stale, returned, new Set(["ref:E1"]), "2026-03-12");
    expect(plan.relink).toEqual([]);
  });

  it("gives each booked movement to one pending row only, oldest first", () => {
    const stale = [p("a", -300, "2026-03-10"), p("b", -300, "2026-03-11")];
    const returned = [r("ref:E1", -300, "2026-03-12")];
    const plan = planPending(stale, returned, new Set(), "2026-03-12");
    expect(plan.relink).toEqual([{ id: "a", external_id: "ref:E1" }]);
  });

  it("prefers a booked candidate over a re-dated pending one", () => {
    const stale = [p("a", -300, "2026-03-10")];
    const returned = [r("h:new", -300, "2026-03-10", "provisorio"), r("ref:E1", -300, "2026-03-13")];
    const plan = planPending(stale, returned, new Set(), "2026-03-13");
    expect(plan.relink).toEqual([{ id: "a", external_id: "ref:E1" }]);
  });

  it("ignores candidates outside the date window", () => {
    const stale = [p("a", -300, "2026-03-10")];
    const returned = [r("ref:E1", -300, "2026-03-25"), r("ref:E2", -300, "2026-03-05")];
    expect(planPending(stale, returned, new Set(), "2026-03-12").relink).toEqual([]);
  });

  it("removes an unmatched pending row only after the grace period", () => {
    const stale = [p("old", -100, "2026-03-01"), p("recent", -100, "2026-03-08")];
    const plan = planPending(stale, [], new Set(), "2026-03-12");
    expect(plan).toEqual({ relink: [], remove: ["old"] });
  });
});
