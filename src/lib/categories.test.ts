import { describe, it, expect } from "vitest";
import {
  canRenameCategory,
  categoriesWithRole,
  categoryRole,
  GROUP_LABELS,
  isProtectedCategory,
  mergeGroupLabels,
  SEED_CATEGORIES,
} from "./categories";

describe("categoryRole", () => {
  it("uses the stored role once the column exists — names no longer matter", () => {
    expect(categoryRole({ grp: "entrada", name: "Ordenado", system_role: "salario" })).toBe("salario");
    expect(categoryRole({ grp: "entrada", name: "Salário extra", system_role: null })).toBeNull();
    expect(categoryRole({ grp: "mesada", name: "Mesada extra", system_role: null })).toBeNull();
  });
  it("falls back to names before migration 0010 (no column)", () => {
    expect(categoryRole({ grp: "entrada", name: "Salário e extras João" })).toBe("salario");
    expect(categoryRole({ grp: "entrada", name: "Renda casa arrendada" })).toBe("renda");
    expect(categoryRole({ grp: "fixa", name: "Salário" })).toBeNull();
  });
  it("lists a role's categories in order", () => {
    const cats = [
      { id: "b", grp: "entrada" as const, name: "Eventos 2", sort: 40, system_role: "eventos" as const },
      { id: "a", grp: "entrada" as const, name: "Eventos", sort: 30, system_role: "eventos" as const },
      { id: "c", grp: "entrada" as const, name: "Eventos falsos", sort: 10, system_role: null },
    ];
    expect(categoriesWithRole(cats, "eventos").map((c) => c.id)).toEqual(["a", "b"]);
  });
  it("seed roles mirror what the names used to mean", () => {
    for (const c of SEED_CATEGORIES) {
      expect(c.system_role ?? null).toBe(categoryRole({ grp: c.grp, name: c.name }));
    }
  });
});

describe("isProtectedCategory", () => {
  it("only mesadas are locked against renaming", () => {
    expect(canRenameCategory({ grp: "entrada", name: "Eventos Joana", system_role: "eventos" })).toBe(true);
    expect(canRenameCategory({ grp: "mesada", name: "Mesada Joana", system_role: "mesada" })).toBe(false);
    expect(canRenameCategory({ grp: "mesada", name: "Mesada extra", system_role: null })).toBe(true);
  });
  it("a new category named like a protected one is not locked", () => {
    expect(isProtectedCategory({ grp: "entrada", name: "Eventos casamento", system_role: null })).toBe(false);
  });
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
