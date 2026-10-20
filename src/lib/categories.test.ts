import { describe, it, expect } from "vitest";
import { GROUP_LABELS, isProtectedCategory, mergeGroupLabels, SEED_CATEGORIES } from "./categories";

describe("isProtectedCategory", () => {
  it("locks the categories the app recognises by name or group", () => {
    expect(isProtectedCategory({ grp: "entrada", name: "Salário e extras João" })).toBe(true);
    expect(isProtectedCategory({ grp: "entrada", name: "Renda casa arrendada" })).toBe(true);
    expect(isProtectedCategory({ grp: "entrada", name: "Eventos Joana" })).toBe(true);
    expect(isProtectedCategory({ grp: "mesada", name: "Mesada Joana" })).toBe(true);
  });
  it("leaves every other seed category editable", () => {
    const editable = SEED_CATEGORIES.filter((c) => !isProtectedCategory(c)).map((c) => c.name);
    expect(editable).toContain("Supermercado");
    expect(editable).toContain("Outras entradas");
    expect(editable).toContain("Reembolsos");
    expect(editable.length).toBe(SEED_CATEGORIES.length - 5);
  });
});

describe("mergeGroupLabels", () => {
  it("applies the household's names over the defaults, ignoring blanks", () => {
    const l = mergeGroupLabels({ variavel: "Dia a dia", fixa: "  " });
    expect(l.variavel).toBe("Dia a dia");
    expect(l.fixa).toBe(GROUP_LABELS.fixa);
    expect(mergeGroupLabels(null)).toEqual(GROUP_LABELS);
  });
});
