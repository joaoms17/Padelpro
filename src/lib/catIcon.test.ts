import { describe, expect, it } from "vitest";
import { catIcon } from "./catIcon";

describe("catIcon", () => {
  it("uses the category's own icon when set", () => {
    expect(catIcon("Supermercado", "🥦")).toBe("🥦");
  });
  it("guesses from the name, accents aside", () => {
    expect(catIcon("Supermercado")).toBe("🛒");
    expect(catIcon("Saúde e farmácia")).toBe("💊");
    expect(catIcon("Prestação casa")).toBe("🏠");
    expect(catIcon("Casa e outras compras")).toBe("🛍️");
    expect(catIcon("Uber Eats e entregas")).toBe("🛵");
  });
  it("falls back to a dot", () => {
    expect(catIcon("Xpto")).toBe("•");
  });
});
