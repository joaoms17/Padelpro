import { describe, it, expect } from "vitest";
import { toDuetEvents, validRange, type DuetEventRow } from "./duet";

const ev = (over: Partial<DuetEventRow>): DuetEventRow => ({
  id: "e1",
  project_id: "p1",
  title: "Casamento Ana",
  event_date: "2026-10-25",
  value: "350.00",
  paid: false,
  ...over,
});
const projects = [{ id: "p1", name: "Cabelos", kind: "hair", color: "#c66" }];
const today = "2026-10-20";

describe("toDuetEvents", () => {
  it("follows Duet's rules: payments win over the legacy paid flag", () => {
    const [a] = toDuetEvents([ev({ paid: true })], [{ event_id: "e1", paid_at: "2026-10-01", amount: "100" }], projects, today);
    expect(a).toMatchObject({ value_cents: 35000, received_cents: 10000, missing_cents: 25000, state: "partial", project: "Cabelos" });
  });
  it("old events without payments count as fully received when flagged paid", () => {
    const [a] = toDuetEvents([ev({ paid: true })], [], projects, today);
    expect(a).toMatchObject({ received_cents: 35000, missing_cents: 0, state: "paid" });
  });
  it("due vs overdue by date; 0 € is 'no value yet' unless confirmed", () => {
    const out = toDuetEvents(
      [
        ev({ id: "a" }),
        ev({ id: "b", event_date: "2026-10-02" }),
        ev({ id: "c", value: 0 }),
        ev({ id: "d", value: "0", zero_confirmed: true }),
      ],
      [],
      projects,
      today,
    );
    expect(out.map((e) => e.state)).toEqual(["due", "overdue", "novalue", "zero"]);
    expect(out[2].missing_cents).toBe(0);
  });
  it("rounds euros to cents and trims the time", () => {
    const [a] = toDuetEvents([ev({ value: "120.45", start_time: "18:30:00", title: "  " })], [], [], today);
    expect(a).toMatchObject({ value_cents: 12045, time: "18:30", title: "Evento", project: null });
  });
});

describe("validRange", () => {
  it("accepts ISO dates up to ~13 months apart", () => {
    expect(validRange("2026-10-01", "2026-10-31")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(validRange("2025-10-01", "2026-10-31")).toEqual({ from: "2025-10-01", to: "2026-10-31" });
  });
  it("rejects anything else", () => {
    expect(validRange("2026-10-31", "2026-10-01")).toBeNull();
    expect(validRange("2024-01-01", "2026-10-31")).toBeNull();
    expect(validRange("ontem", "2026-10-01")).toBeNull();
    expect(validRange(undefined, null)).toBeNull();
  });
});
