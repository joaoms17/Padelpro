import type { CategoryGroup, SystemRole } from "./types";

// Initial categories (section 6.1). Editable in the app; this list seeds a new
// household and mirrors supabase/migrations/0003_seed_categories.sql.
export interface SeedCategory {
  grp: CategoryGroup;
  name: string;
  system_role?: SystemRole | null;
}

/** Order of the groups ("separadores") everywhere in the app. */
export const GROUP_ORDER: CategoryGroup[] = ["entrada", "fixa", "variavel", "atividade", "mesada", "interna"];

/** Group names, the same everywhere in the app. */
export const GROUP_LABELS: Record<CategoryGroup, string> = {
  entrada: "Entradas",
  fixa: "Contas fixas",
  variavel: "Dia a dia",
  atividade: "Trabalho da Joana",
  mesada: "Para vocês",
  interna: "Poupança",
};

// The short list (migration 0015): few categories, so it is easy to see
// where the money goes.
export const SEED_CATEGORIES: SeedCategory[] = [
  // Entradas
  { grp: "entrada", name: "Ordenado João", system_role: "salario" },
  { grp: "entrada", name: "Despesas de representação", system_role: "representacao" },
  { grp: "entrada", name: "Renda casa arrendada", system_role: "renda" },
  { grp: "entrada", name: "Eventos Joana", system_role: "eventos" },
  { grp: "entrada", name: "Outras entradas" },
  // Contas fixas
  { grp: "fixa", name: "Prestação casa" },
  { grp: "fixa", name: "Prestação casa arrendada" },
  { grp: "fixa", name: "Luz, água, gás e internet" },
  { grp: "fixa", name: "Seguros" },
  { grp: "fixa", name: "Subscrições" },
  { grp: "fixa", name: "Condomínio, IMI e outras" },
  // Dia a dia
  { grp: "variavel", name: "Supermercado" },
  { grp: "variavel", name: "Restaurantes e cafés" },
  { grp: "variavel", name: "Uber Eats e entregas" },
  { grp: "variavel", name: "Compras online" },
  { grp: "variavel", name: "Nutrição e suplementos" },
  { grp: "variavel", name: "Carro e transportes" },
  { grp: "variavel", name: "Saúde e farmácia" },
  { grp: "variavel", name: "Maggie" },
  { grp: "variavel", name: "Viagens e lazer" },
  { grp: "variavel", name: "Casa e outras compras" },
  // Trabalho da Joana
  { grp: "atividade", name: "Trabalho da Joana" },
  // Para vocês
  { grp: "mesada", name: "Para o João", system_role: "mesada" },
  { grp: "mesada", name: "Para a Joana", system_role: "mesada" },
  // Poupança
  { grp: "interna", name: "Poupança" },
];

/** Group names (renaming groups was removed: the same words everywhere). */
export function mergeGroupLabels(
  _custom?: Partial<Record<string, string>> | null,
): Record<CategoryGroup, string> {
  return { ...GROUP_LABELS };
}

type RoleLike = { grp: CategoryGroup; name: string; system_role?: SystemRole | null };

// How each role was recognised before migration 0010 gave categories a role.
const LEGACY_ROLE: [SystemRole, (c: RoleLike) => boolean][] = [
  ["salario", (c) => c.grp === "entrada" && /sal[áa]rio|ordenado/i.test(c.name)],
  ["representacao", (c) => c.grp === "entrada" && /represent/i.test(c.name)],
  ["renda", (c) => c.grp === "entrada" && /renda casa/i.test(c.name)],
  ["eventos", (c) => c.grp === "entrada" && /eventos/i.test(c.name)],
  ["mesada", (c) => c.grp === "mesada"],
];

/**
 * The part a category plays in the app's calculations: salário + renda make
 * the base fixa, "eventos" receives event payments, mesadas map to members.
 * Stored in system_role; recognised by name only while that column is absent.
 */
export function categoryRole(c: RoleLike): SystemRole | null {
  if (c.system_role !== undefined) return c.system_role ?? null;
  return LEGACY_ROLE.find(([, test]) => test(c))?.[0] ?? null;
}

/** Categories with a role, in their order (the first one is "the" one). */
export function categoriesWithRole<T extends RoleLike & { sort?: number }>(
  categories: T[],
  role: SystemRole,
): T[] {
  return categories
    .filter((c) => categoryRole(c) === role)
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

/**
 * Categories with a role can't change separator or be removed (the
 * calculations would lose them); renaming is fine, except for mesadas,
 * which are matched to each person by name.
 */
export function isProtectedCategory(c: RoleLike): boolean {
  return categoryRole(c) != null;
}
export function canRenameCategory(c: RoleLike): boolean {
  return categoryRole(c) !== "mesada";
}
