import { describe, it, expect } from "vitest";
import { matchesKeyword } from "@shared/categorize";
import {
  defaultVista,
  groupByCategory,
  groupByDay,
  groupUncategorized,
  inIncomeLine,
  matchesSearch,
  parseVista,
  rowTitle,
  ruleReach,
  salaryNote,
  salarySplit,
  titleCase,
  transferKeyword,
  transferTargets,
  type TriageTx,
} from "./triage";
import { monthBreakdown, type EngineCtx, type MonthBreakdown } from "./month";

let n = 0;
const t = (date: string, cents: number, desc: string | null, category_id: string | null = null) => ({
  id: `t${n++}`,
  booking_date: date,
  amount_cents: cents,
  description_raw: desc,
  category_id,
});

describe("transferKeyword", () => {
  it("keeps who the transfer is with, not the bank's words", () => {
    expect(transferKeyword("TRF IMED P/ JOAO MANUEL SILVA")).toBe("joao manuel silva");
    expect(transferKeyword("TRF CRED SEPA+ DE JOANA CARNEIRO MORAES -300515672")).toBe("joana carneiro moraes");
    expect(transferKeyword("TRF.IMED. DE JOANA CARNEIRO MORAES-R09668271")).toBe("joana carneiro moraes");
    expect(transferKeyword("MB WAY P/ JOANA CARNEIRO")).toBe("joana carneiro");
    expect(transferKeyword("MB WAY 912345678")).toBe("");
  });

  it("is always found in the description, so a rule matches the movement", () => {
    for (const d of ["TRF IMED P/ JOAO MANUEL SILVA", "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES -300515672", "MB WAY P/ JOANA CARNEIRO"]) {
      expect(matchesKeyword(d, transferKeyword(d))).toBe(true);
    }
  });
});

describe("rowTitle", () => {
  it("names who a transfer is with, and the shop otherwise", () => {
    expect(rowTitle("TRF IMED P/ JOAO MANUEL SILVA")).toBe("Joao Manuel Silva");
    expect(rowTitle("MB WAY P/ JOANA CARNEIRO")).toBe("Joana Carneiro");
    expect(rowTitle("DD MEO SA")).toBe("Meo sa");
    expect(rowTitle("COMPRA CONTINENTE LUMIAR")).toBe("Continente Lumiar");
    expect(rowTitle("MB WAY 912345678")).toBe("MB WAY 912345678");
    expect(rowTitle(null)).toBe("");
  });
});

describe("titleCase", () => {
  it("capitalizes the words longer than 2 letters", () => {
    expect(titleCase("uber eats")).toBe("Uber Eats");
    expect(titleCase("galp s joao")).toBe("Galp s Joao");
  });
});

describe("groupUncategorized", () => {
  const rows = [
    t("2026-09-13", -2390, "UBER *EATS PORTUGAL"),
    t("2026-09-20", -3150, "UBER *EATS PORTUGAL"),
    t("2026-09-15", -5590, "Estrang Www Amazon Nk8yt9dq4"),
    t("2026-09-22", -1299, "Estrang Www Amazon Xy12ab34"),
    t("2026-09-23", 1299, "Estrang Www Amazon 5512"),
    t("2026-09-16", -2899, "TEMU.COM DUBLIN"),
    t("2026-09-01", -50000, "TRF IMED P/ JOAO MANUEL SILVA"),
    t("2026-09-26", -30000, "TRF IMED P/ JOAO MANUEL SILVA"),
    t("2026-09-06", 50000, "TRF.IMED. DE JOANA CARNEIRO MORAES-R09668271"),
    t("2026-09-09", 50000, "TRF CRED SEPA+ DE JOANA CARNEIRO MORAES -300515672"),
    t("2026-09-27", -30000, "TRF IMED P/ JOANA CARNEIRO MORAES"),
    t("2026-09-18", -4999, "PROZIS.COM"),
    t("2026-09-19", -100, null),
  ];
  const groups = groupUncategorized(rows);
  const byLabel = (l: string) => groups.find((g) => g.label === l)!;

  it("groups by keyword, newest first, with totals", () => {
    const uber = byLabel("Uber Eats");
    expect(uber.rows.map((r) => r.booking_date)).toEqual(["2026-09-20", "2026-09-13"]);
    expect(uber.totalCents).toBe(5540);
    expect(uber.netCents).toBe(-5540);
    expect(uber.keyword).toBe("uber eats");
    expect(uber.transfer).toBe(false);
    const amazon = byLabel("Amazon");
    expect(amazon.rows).toHaveLength(3);
    expect(amazon.totalCents).toBe(5590 + 1299 + 1299);
    expect(amazon.netCents).toBe(-5590);
  });

  it("splits transfers by person and direction", () => {
    const joao = byLabel("Joao Manuel Silva");
    expect(joao.rows).toHaveLength(2);
    expect(joao.transfer).toBe(true);
    expect(joao.incoming).toBe(false);
    const joanaIn = groups.filter((g) => g.label === "Joana Carneiro Moraes");
    expect(joanaIn).toHaveLength(2);
    expect(joanaIn.find((g) => g.incoming)!.rows).toHaveLength(2);
    expect(joanaIn.find((g) => !g.incoming)!.rows).toHaveLength(1);
  });

  it("puts groups of 2+ first (biggest first), singles after", () => {
    const sizes = groups.map((g) => g.rows.length);
    const firstSingle = sizes.findIndex((s) => s < 2);
    expect(sizes.slice(firstSingle).every((s) => s === 1)).toBe(true);
    expect(sizes.slice(0, firstSingle).every((s) => s >= 2)).toBe(true);
    const multi = groups.slice(0, firstSingle).map((g) => g.totalCents);
    expect([...multi].sort((a, b) => b - a)).toEqual(multi);
    expect(groups[0].label).toBe("Joana Carneiro Moraes");
    expect(groups[0].incoming).toBe(true);
    const singles = groups.slice(firstSingle).map((g) => g.totalCents);
    expect([...singles].sort((a, b) => b - a)).toEqual(singles);
  });

  it("falls back to 'Outros' without a description, with no rule keyword", () => {
    const o = byLabel("Outros");
    expect(o.rows).toHaveLength(1);
    expect(o.keyword).toBe("");
  });

  it("picks the most common suggestion of the group", () => {
    const rs = [t("2026-09-01", -100, "COMPRA CONTINENTE A"), t("2026-09-02", -100, "COMPRA CONTINENTE B"), t("2026-09-03", -100, "COMPRA CONTINENTE C")];
    const sug: Record<string, string | null> = { [rs[0].id]: "x", [rs[1].id]: "sup", [rs[2].id]: "sup" };
    const [g] = groupUncategorized(rs, (r: TriageTx) => sug[r.id]);
    expect(g.suggestion).toBe("sup");
    const [none] = groupUncategorized(rs, () => null);
    expect(none.suggestion).toBeNull();
  });
});

describe("groupByCategory", () => {
  it("groups by the resolved category, biggest first", () => {
    const rows = [t("2026-09-01", -1000, "A", "sup"), t("2026-09-03", -500, "B", "old"), t("2026-09-02", -3000, "C", "luz"), t("2026-09-04", -10, "D", null)];
    const g = groupByCategory(rows, (id) => (id === "old" ? "sup" : id));
    expect(g.map((x) => x.categoryId)).toEqual(["luz", "sup"]);
    expect(g[1].rows.map((r) => r.description_raw)).toEqual(["B", "A"]);
    expect(g[1].totalCents).toBe(1500);
  });
});

describe("groupByDay", () => {
  it("newest day first", () => {
    const rows = [t("2026-09-01", -1, "a"), t("2026-09-03", -1, "b"), t("2026-09-01", -1, "c")];
    const days = groupByDay(rows);
    expect(days.map(([d]) => d)).toEqual(["2026-09-03", "2026-09-01"]);
    expect(days[1][1].map((r) => r.description_raw)).toEqual(["a", "c"]);
  });
});

describe("matchesSearch", () => {
  it("matches every word, ignoring accents and case", () => {
    expect(matchesSearch("COMPRA CONTINENTE LUMIAR", "continente")).toBe(true);
    expect(matchesSearch("TRF P/ JOÃO", "joao trf")).toBe(true);
    expect(matchesSearch("COMPRA LIDL", "continente")).toBe(false);
    expect(matchesSearch(null, "")).toBe(true);
  });
});

describe("vistas", () => {
  it("parses only known views", () => {
    expect(parseVista("validar")).toBe("validar");
    expect(parseVista("x")).toBeNull();
    expect(parseVista(null)).toBeNull();
  });
  it("opens on what still needs doing", () => {
    expect(defaultVista(3, 2, false)).toBe("categorizar");
    expect(defaultVista(0, 2, false)).toBe("validar");
    expect(defaultVista(0, 0, false)).toBe("todos");
    expect(defaultVista(3, 2, true)).toBe("todos");
  });
});

describe("transferTargets", () => {
  const cats = [
    { id: "pj", name: "Para o João", grp: "mesada", system_role: "mesada", sort: 1 },
    { id: "pa", name: "Para a Joana", grp: "mesada", system_role: "mesada", sort: 2 },
    { id: "gin", name: "Ginásio", grp: "mesada", sort: 3 },
    { id: "pou", name: "Poupança", grp: "interna" },
  ];
  it("each of you, then savings", () => {
    const members = [
      { id: "mj", display_name: "João" },
      { id: "ma", display_name: "Joana" },
    ];
    expect(transferTargets(cats, members)).toEqual([
      { id: "pj", label: "Para o João" },
      { id: "pa", label: "Para a Joana" },
      { id: "pou", label: "Poupança" },
    ]);
  });
  it("without members: the app's own 'Para vocês' categories", () => {
    expect(transferTargets(cats, []).map((x) => x.id)).toEqual(["pj", "pa", "pou"]);
  });
});

describe("ruleReach (group 'Aplicar também aos próximos')", () => {
  it("says how many movements the word catches today, besides the group's own", () => {
    expect(ruleReach(9, 9)).toBe("Apanha 9 movimentos até hoje: só estes.");
    expect(ruleReach(1, 1)).toBe("Apanha 1 movimento até hoje: só este.");
    expect(ruleReach(23, 9)).toBe("Apanha 23 movimentos até hoje: estes 9 e mais 14, que ficam como estão.");
    expect(ruleReach(2, 1)).toBe("Apanha 2 movimentos até hoje: este e mais 1, que fica como está.");
    // The group's rows always contain the word: never fewer than them.
    expect(ruleReach(0, 3)).toBe("Apanha 3 movimentos até hoje: só estes.");
  });
});

describe("income lines (linha filter)", () => {
  const sp = (s: string | null) => s?.replace(/ /g, " ") ?? null;
  const salary = { area: "entrada" as const, key: "ordenado" };
  it("the extra is the salary movement, only in a month that had one", () => {
    const withExtra = new Set(["2026-08"]);
    expect(inIncomeLine(salary, "ordenado", "2026-09", withExtra)).toBe(true);
    expect(inIncomeLine(salary, "extra", "2026-08", withExtra)).toBe(true);
    expect(inIncomeLine(salary, "extra", "2026-09", withExtra)).toBe(false);
    expect(inIncomeLine({ area: "entrada", key: "representacao" }, "extra", "2026-08", withExtra)).toBe(false);
    expect(inIncomeLine({ area: "entrada", key: "representacao" }, "representacao", "2026-08", withExtra)).toBe(true);
    expect(inIncomeLine({ area: "voces", key: "mj" }, "ordenado", "2026-08", withExtra)).toBe(false);
  });
  it("splits the salary movement's total as Meses does", () => {
    const line = (key: string, cents: number) => ({ key, cents }) as unknown as MonthBreakdown["entradas"][number];
    const august = { entradas: [line("ordenado", 195157), line("extra", 569231)] };
    const september = { entradas: [line("ordenado", 195157), line("extra", 0)] };
    expect(salarySplit(august)).toEqual({ normal: 195157, extra: 569231 });
    expect(sp(salaryNote("ordenado", salarySplit(august), 1))).toBe("Este total inclui o extra (prémio, subsídio): 1 951,57 € de ordenado + 5 692,31 € de extra.");
    expect(sp(salaryNote("extra", salarySplit(august), 1))).toBe("O extra veio junto com o ordenado, neste movimento: 1 951,57 € de ordenado + 5 692,31 € de extra.");
    expect(sp(salaryNote("extra", salarySplit(august), 2))).toContain("nestes movimentos");
    expect(salaryNote("ordenado", salarySplit(september), 1)).toBeNull();
    expect(salaryNote("extra", salarySplit(september), 1)).toBeNull();
  });
  it("with the engine: the parts add up to the salary movements listed", () => {
    const cats = [
      { id: "ord", grp: "entrada", name: "Ordenado João", system_role: "salario", archived: false, merged_into: null, sort: 0, budget_cents: null },
    ] as EngineCtx["categories"];
    const ctx: EngineCtx = {
      categories: cats,
      members: [],
      incomes: [
        { id: "i1", household_id: "h", label: "Ordenado Joao", amount_cents: 195157, parts: 1, day: 23, every_months: 1, anchor_month: "2026-07-01", match_text: "ntt data", active: true, kind: "salario" },
      ] as EngineCtx["incomes"],
      today: "2026-10-21",
      firstDataDate: "2026-07-01",
    };
    const txs = [
      { id: "a", booking_date: "2026-08-22", amount_cents: 764388, description_raw: "TRF NTT DATA", category_id: "ord", source: "banco" as const },
      { id: "b", booking_date: "2026-09-22", amount_cents: 195157, description_raw: "TRF NTT DATA", category_id: "ord", source: "banco" as const },
    ];
    const aug = salarySplit(monthBreakdown(txs, ctx, "2026-08"));
    expect(aug.normal + aug.extra).toBe(764388);
    expect(aug.extra).toBe(569231);
    expect(salarySplit(monthBreakdown(txs, ctx, "2026-09")).extra).toBe(0);
  });
});
