import { describe, it, expect } from "vitest";
import { applyPatch, appliedPatch, isEmptyPatch, mergePatch, planDiff, planMonths, unappliedChanges } from "./planPatch";
import { normalizePlan } from "./plan";
import { withDefaults } from "./planView";
import { formatEuros } from "./format";

const members = [
  { id: "mj", display_name: "João" },
  { id: "ma", display_name: "Joana" },
];
const ids = members.map((m) => m.id);

describe("plan patches", () => {
  it("only what changed, per person for the mesadas and the transition", () => {
    const a = normalizePlan({ mesadas: { mj: 60000, ma: 60000 }, transition: { mj: 50000, ma: 0 }, savings_cents: 10000 });
    expect(isEmptyPatch(planDiff(a, a))).toBe(true);
    expect(planDiff(a, { ...a, savings_cents: 25000 })).toEqual({ savings_cents: 25000 });
    expect(planDiff(a, { ...a, mesadas: { ...a.mesadas, mj: 70000 } })).toEqual({ mesadas: { mj: 70000 } });
    expect(planDiff(a, { ...a, extras_rule: "poupanca", mesada_covers: ["c12"] })).toEqual({ extras_rule: "poupanca", mesada_covers: ["c12"] });
    // Clearing a value is a change too.
    expect(planDiff({ ...a, mesada_covers: ["c12"] }, a)).toEqual({ mesada_covers: [] });
  });

  it("patches in a row: the later one wins, people add up", () => {
    const m = mergePatch({ savings_cents: 100, mesadas: { mj: 1 } }, { savings_cents: 200, mesadas: { ma: 2 } });
    expect(m).toEqual({ savings_cents: 200, mesadas: { mj: 1, ma: 2 } });
    expect(mergePatch({}, {})).toEqual({});
  });

  it("a patch on top of a plan leaves the rest as it was", () => {
    const p = normalizePlan({ mesadas: { mj: 60000, ma: 60000 }, extras_rule: "decidir", mesada_covers: ["c12"] });
    const out = applyPatch(p, { mesadas: { mj: 70000 }, savings_cents: 5000 });
    expect(out.mesadas).toEqual({ mj: 70000, ma: 60000 });
    expect(out.savings_cents).toBe(5000);
    expect(out.extras_rule).toBe("decidir");
    expect(out.mesada_covers).toEqual(["c12"]);
    expect(p.mesadas.mj).toBe(60000); // untouched
  });

  it("two phones: João's change is written on top of what Joana saved meanwhile", () => {
    // Both opened the plan at 10:00.
    const loaded = withDefaults(normalizePlan({ mesadas: { mj: 60000, ma: 60000 } }), members);
    // 10:05 Joana changes where the extras go; the server now has it.
    const server = applyPatch(loaded, { extras_rule: "poupanca" });
    // 10:07 João changes the poupança on his (stale) screen.
    const joao = { ...loaded, savings_cents: 30000 };
    const saved = applyPatch(server, planDiff(loaded, joao));
    expect(saved.extras_rule).toBe("poupanca");
    expect(saved.savings_cents).toBe(30000);
  });

  it("a stale reload while a change is being saved: the change stays on screen", () => {
    const before = normalizePlan({ mesada_covers: [] });
    const sending = { mesada_covers: ["c12"] };
    const edits = { savings_cents: 10000 };
    // The reload read the plan before the save landed.
    const shown = applyPatch(applyPatch(before, sending), edits);
    expect(shown.mesada_covers).toEqual(["c12"]);
    // The next change only writes itself: the server keeps the chip.
    expect(Object.keys(planDiff(shown, { ...shown, savings_cents: 20000 }))).toEqual(["savings_cents"]);
  });

  it("what 'Pôr o plano em vigor' writes to the plan", () => {
    const p = normalizePlan({ mesadas: { mj: 60000, ma: 60000, old: 1 }, transition: { mj: 50000, ma: 0 }, mesada_day: 2, savings_cents: 999 });
    expect(appliedPatch(p, ids)).toEqual({
      active: true,
      start_month: "2026-12",
      mesada_day: 2,
      mesadas: { mj: 60000, ma: 60000 },
      transition: { mj: 50000, ma: 0 },
    });
    // The rest of the plan (typed meanwhile on the other phone, or here) is not touched.
    const server = applyPatch(p, { savings_cents: 25000 });
    expect(applyPatch(server, appliedPatch(p, ids)).savings_cents).toBe(25000);
  });
});

describe("the months 'Pôr o plano em vigor' writes", () => {
  it("before the start: the past and this month keep their value, November is the transition", () => {
    expect(planMonths("2026-07", "2026-10", "2026-12")).toEqual({
      keep: ["2026-07", "2026-08", "2026-09", "2026-10"],
      transition: ["2026-11"],
      from: "2026-12",
    });
  });

  it("an update after the start: the plan's months already lived keep what they had", () => {
    expect(planMonths("2026-07", "2027-02", "2026-12")).toEqual({
      keep: ["2026-07", "2026-08", "2026-09", "2026-10", "2026-12", "2027-01"],
      transition: ["2026-11"],
      from: "2027-02",
    });
    // In the first month itself the new value applies to it.
    expect(planMonths("2026-07", "2026-12", "2026-12").from).toBe("2026-12");
  });
});

describe("changes not applied yet", () => {
  const applied = [
    { id: "mj", display_name: "João", mesada_cents: 60000, mesada_day: 1 },
    { id: "ma", display_name: "Joana", mesada_cents: 60000, mesada_day: 1 },
  ];
  const overrides = [
    { member_id: "mj", month: "2026-11-01", amount_cents: 50000 },
    { member_id: "ma", month: "2026-11-01", amount_cents: 0 },
  ];
  const plan = normalizePlan({ active: true, mesadas: { mj: 60000, ma: 60000 }, transition: { mj: 50000, ma: 0 }, mesada_day: 1 });

  it("nothing when what is in place is the plan, or the plan is not active", () => {
    expect(unappliedChanges(plan, applied, overrides, "2026-10")).toEqual([]);
    expect(unappliedChanges({ ...plan, active: false, mesadas: { mj: 1 } }, applied, overrides, "2026-10")).toEqual([]);
  });

  it("a mesada, the transition and the day changed after it was put in place", () => {
    const edited = { ...plan, mesadas: { mj: 70000, ma: 60000 }, transition: { mj: 40000, ma: 0 }, mesada_day: 5 };
    expect(unappliedChanges(edited, applied, overrides, "2026-10")).toEqual([
      `Mesada do João em novembro (transição): ${formatEuros(50000)} → ${formatEuros(40000)}`,
      `Mesada do João: ${formatEuros(60000)} → ${formatEuros(70000)}`,
      "Dia da transferência: dia 1 → dia 5",
    ]);
  });

  it("past transition months are history", () => {
    const edited = { ...plan, transition: { mj: 40000, ma: 0 } };
    expect(unappliedChanges(edited, applied, overrides, "2026-12")).toEqual([]);
  });

  it("after the start, this month's mesada (its own value, if it has one)", () => {
    const pinned = [...overrides, { member_id: "ma", month: "2027-01-01", amount_cents: 55000 }];
    expect(unappliedChanges(plan, applied, pinned, "2027-01")).toEqual([`Mesada da Joana: ${formatEuros(55000)} → ${formatEuros(60000)}`]);
  });
});
