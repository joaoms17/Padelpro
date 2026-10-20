import { describe, it, expect } from "vitest";
import {
  findStale,
  candidateIds,
  planPending,
  fetchStart,
  type StoredPending,
  type ReturnedRow,
} from "./pending";

const p = (id: string, amount: number, date: string, extra: Partial<StoredPending> = {}): StoredPending => ({
  id,
  external_id: `h:${id}`,
  amount_cents: amount,
  booking_date: date,
  ...extra,
});
const r = (
  ext: string,
  amount: number,
  date: string,
  status: ReturnedRow["status"] = "confirmado",
  description_raw = "",
): ReturnedRow => ({ external_id: ext, amount_cents: amount, booking_date: date, status, description_raw });

describe("findStale", () => {
  it("splits not-returned rows into stale (in window), expired (older) and future (left alone)", () => {
    const pending = [
      p("a", -500, "2026-03-10"),
      p("b", -700, "2026-03-11"),
      p("old", -900, "2026-02-01"),
      p("future", -50000, "2026-03-21"),
    ];
    const { stale, expired } = findStale(pending, new Set(["h:b"]), "2026-03-01", "2026-03-20");
    expect(stale.map((s) => s.id)).toEqual(["a"]);
    expect(expired).toEqual(["old"]);
  });
});

describe("planPending", () => {
  it("re-points a pending row to its booked version (same amount, a day later)", () => {
    const stale = [p("a", -4520, "2026-03-10")];
    const returned = [r("ref:E1", -4520, "2026-03-11"), r("ref:E2", -1000, "2026-03-11")];
    expect(candidateIds(stale, returned)).toEqual(["ref:E1"]);
    expect(planPending(stale, returned, [], "2026-03-12")).toEqual({
      relink: [{ id: "a", external_id: "ref:E1" }],
      merge: [],
      remove: [],
    });
  });

  it("merges into a booked row stored while the pending one was still listed", () => {
    const stale = [p("a", -1200, "2026-03-02", { created_at: "2026-03-02T18:00:00Z" })];
    const returned = [r("ref:E9", -1200, "2026-03-03")];
    const stored = [{ id: "row-e9", external_id: "ref:E9", created_at: "2026-03-03T06:00:00Z" }];
    expect(planPending(stale, returned, stored, "2026-03-03")).toEqual({
      relink: [],
      merge: [{ id: "a", into_id: "row-e9" }],
      remove: [],
    });
  });

  it("never merges into an older, unrelated stored movement", () => {
    const stale = [p("a", -1200, "2026-03-02", { created_at: "2026-03-02T18:00:00Z" })];
    const stored = [{ id: "old", external_id: "ref:E1", created_at: "2026-03-01T06:00:00Z" }];
    const plan = planPending(stale, [r("ref:E1", -1200, "2026-03-01")], stored, "2026-03-03");
    expect(plan.merge).toEqual([]);
    expect(plan.relink).toEqual([]);
  });

  it("gives each booked movement to one pending row only, oldest first", () => {
    const stale = [p("a", -300, "2026-03-10"), p("b", -300, "2026-03-11")];
    const plan = planPending(stale, [r("ref:E1", -300, "2026-03-12")], [], "2026-03-12");
    expect(plan.relink).toEqual([{ id: "a", external_id: "ref:E1" }]);
  });

  it("prefers booked, then the similar merchant, over a closer unrelated one", () => {
    const stale = [p("a", -5000, "2026-03-10", { description_raw: "COMPRA GALP LISBOA" })];
    const returned = [
      r("h:new", -5000, "2026-03-10", "provisorio", "COMPRA GALP LISBOA"),
      r("ref:MBWAY", -5000, "2026-03-10", "confirmado", "MBWAY AMIGO"),
      r("ref:GALP", -5000, "2026-03-12", "confirmado", "GALP LISBOA"),
    ];
    expect(planPending(stale, returned, [], "2026-03-13").relink).toEqual([
      { id: "a", external_id: "ref:GALP" },
    ]);
  });

  it("ignores candidates outside the date window", () => {
    const stale = [p("a", -300, "2026-03-10")];
    const returned = [r("ref:E1", -300, "2026-03-25"), r("ref:E2", -300, "2026-03-05")];
    expect(planPending(stale, returned, [], "2026-03-12").relink).toEqual([]);
  });

  it("removes an unmatched pending row only after the grace period", () => {
    const stale = [p("old", -100, "2026-03-01"), p("recent", -100, "2026-03-08")];
    expect(planPending(stale, [], [], "2026-03-12")).toEqual({ relink: [], merge: [], remove: ["old"] });
  });
});

describe("planPending — evidence that it is the same movement", () => {
  it("never folds a released fuel hold into an unrelated withdrawal of the same amount", () => {
    const stale = [p("galp", -5000, "2026-10-10", { description_raw: "COMPRA GALP LISBOA", created_at: "2026-10-10T18:00:00Z" })];
    const returned = [r("ref:ATM1", -5000, "2026-10-11", "confirmado", "LEVANTAMENTO MULTIBANCO")];
    const stored = [{ id: "atm", external_id: "ref:ATM1", created_at: "2026-10-11T18:00:00Z" }];
    expect(planPending(stale, returned, stored, "2026-10-12")).toEqual({ relink: [], merge: [], remove: [] });
    // ...and it simply expires after the grace period.
    expect(planPending(stale, returned, stored, "2026-10-21").remove).toEqual(["galp"]);
  });

  it("prefers the stored booked version over an unrelated fresh movement", () => {
    const stale = [p("rest", -2000, "2026-10-10", { description_raw: "RESTAURANTE O PATEO", created_at: "2026-10-10T18:00:00Z" })];
    const returned = [
      r("ref:R1", -2000, "2026-10-11", "confirmado", "RESTAURANTE O PATEO"),
      r("ref:M1", -2000, "2026-10-11", "confirmado", "MBWAY JOAO"),
    ];
    const stored = [{ id: "r1", external_id: "ref:R1", created_at: "2026-10-11T06:00:00Z" }];
    expect(planPending(stale, returned, stored, "2026-10-11")).toEqual({
      relink: [],
      merge: [{ id: "rest", into_id: "r1" }],
      remove: [],
    });
  });

  it("merges a pending twin into its booked version with the same hashed base", () => {
    // Bank listed booked + pending together (base, base#1); then the pending went.
    const stale = [p("twin", -120, "2026-10-10", {
      external_id: "h:2026-10-10:-120:abc#1",
      description_raw: "CAFE A",
      created_at: "2026-10-11T06:00:00Z",
    })];
    const returned = [r("h:2026-10-10:-120:abc", -120, "2026-10-10", "confirmado", "CAFE A")];
    const stored = [{ id: "base", external_id: "h:2026-10-10:-120:abc", created_at: "2026-10-10T18:00:00Z" }];
    expect(planPending(stale, returned, stored, "2026-10-11").merge).toEqual([{ id: "twin", into_id: "base" }]);
  });

  it("a cancelled stored pending row is relinked if its booking is there, else removed at once", () => {
    const stale = [p("c", -120, "2026-10-10", { external_id: "h:x", description_raw: "CAFE A" })];
    const withBooking = [r("ref:A1", -120, "2026-10-10", "confirmado", "CAFE A")];
    expect(planPending(stale, withBooking, [], "2026-10-11", 10, new Set(["h:x"])).relink)
      .toEqual([{ id: "c", external_id: "ref:A1" }]);
    expect(planPending(stale, [], [], "2026-10-11", 10, new Set(["h:x"])).remove).toEqual(["c"]);
  });
});

describe("fetchStart", () => {
  it("pulls the window back to cover open pending rows, capped at 30 days", () => {
    expect(fetchStart("2026-03-25", [p("a", -1, "2026-03-20")], "2026-03-31")).toBe("2026-03-17");
    expect(fetchStart("2026-03-25", [p("a", -1, "2026-01-05")], "2026-03-31")).toBe("2026-03-01");
    expect(fetchStart("2026-03-25", [], "2026-03-31")).toBe("2026-03-25");
  });
  it("never shortens a longer incremental window (after an outage)", () => {
    expect(fetchStart("2026-01-10", [p("a", -1, "2026-03-20")], "2026-03-31")).toBe("2026-01-10");
  });
  it("ignores future-dated (scheduled) rows", () => {
    expect(fetchStart("2026-03-25", [p("s", -1, "2026-04-05")], "2026-03-31")).toBe("2026-03-25");
  });
});

// The two scenarios the review simulated, end to end over 12-hour syncs.
describe("pending lifecycle across syncs", () => {
  const syncs = (start: string, days: number) =>
    Array.from({ length: days }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000)
      .toISOString().slice(0, 10));

  it("a released hold (no CNCL) is removed after the grace period", () => {
    let pending = [p("hold", -20000, "2026-03-02")];
    let removed: string[] = [];
    for (const today of syncs("2026-03-05", 30)) {
      const from = fetchStart(today, pending, today); // incremental window ~ today
      const { stale, expired } = findStale(pending, new Set(), from, today);
      const plan = planPending(stale, [], [], today);
      removed = [...removed, ...expired, ...plan.remove];
      pending = pending.filter((x) => !removed.includes(x.id));
    }
    expect(removed).toEqual(["hold"]);
  });

  it("a pending booked a week later is relinked, not duplicated", () => {
    const pending = [p("pend", -8000, "2026-03-02")];
    const today = "2026-03-09";
    const from = fetchStart("2026-03-03", pending, today);
    expect(from <= "2026-03-02").toBe(true);
    const returned = [r("ref:E1", -8000, "2026-03-09")];
    const { stale } = findStale(pending, new Set(returned.map((x) => x.external_id)), from, today);
    expect(planPending(stale, returned, [], today).relink).toEqual([{ id: "pend", external_id: "ref:E1" }]);
  });
});
