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

/** Default group names; each household can rename them (settings.group_labels). */
export const GROUP_LABELS: Record<CategoryGroup, string> = {
  entrada: "Entradas",
  fixa: "Fixas",
  variavel: "Variáveis do casal",
  atividade: "Atividade Joana",
  mesada: "Mesadas",
  interna: "Transferências internas",
};

export const SEED_CATEGORIES: SeedCategory[] = [
  // Entradas
  { grp: "entrada", name: "Salário e extras João", system_role: "salario" },
  { grp: "entrada", name: "Renda casa arrendada", system_role: "renda" },
  { grp: "entrada", name: "Eventos Joana", system_role: "eventos" },
  { grp: "entrada", name: "Reembolsos" },
  { grp: "entrada", name: "Outras entradas" },
  // Fixas
  { grp: "fixa", name: "Crédito habitação e prestações" },
  { grp: "fixa", name: "Condomínio" },
  { grp: "fixa", name: "Luz" },
  { grp: "fixa", name: "Água" },
  { grp: "fixa", name: "Gás" },
  { grp: "fixa", name: "Internet e telemóvel" },
  { grp: "fixa", name: "Seguros" },
  { grp: "fixa", name: "Subscrições" },
  { grp: "fixa", name: "Impostos da casa (IMI, IUC)" },
  { grp: "fixa", name: "Outras fixas" },
  // Variáveis do casal
  { grp: "variavel", name: "Supermercado" },
  { grp: "variavel", name: "Restaurantes e saídas" },
  { grp: "variavel", name: "Uber Eats e entregas" },
  { grp: "variavel", name: "Combustível e carregamentos" },
  { grp: "variavel", name: "Transportes e portagens" },
  { grp: "variavel", name: "Casa e manutenção" },
  { grp: "variavel", name: "Saúde e farmácia" },
  { grp: "variavel", name: "Maggie" },
  { grp: "variavel", name: "Roupa e cuidado pessoal" },
  { grp: "variavel", name: "Lazer e concertos" },
  { grp: "variavel", name: "Viagens" },
  { grp: "variavel", name: "Prendas" },
  { grp: "variavel", name: "Compras online" },
  { grp: "variavel", name: "Outras variáveis" },
  // Atividade Joana
  { grp: "atividade", name: "Material" },
  { grp: "atividade", name: "Deslocações" },
  { grp: "atividade", name: "Alojamento em trabalho" },
  { grp: "atividade", name: "Outras despesas da atividade" },
  // Mesadas
  { grp: "mesada", name: "Mesada João", system_role: "mesada" },
  { grp: "mesada", name: "Mesada Joana", system_role: "mesada" },
  // Transferências internas
  { grp: "interna", name: "Entre contas" },
];

/** Default group names overridden by the household's own (blank = default). */
export function mergeGroupLabels(
  custom: Partial<Record<string, string>> | null | undefined,
): Record<CategoryGroup, string> {
  const out = { ...GROUP_LABELS };
  for (const g of GROUP_ORDER) {
    const v = custom?.[g]?.trim();
    if (v) out[g] = v;
  }
  return out;
}

type RoleLike = { grp: CategoryGroup; name: string; system_role?: SystemRole | null };

// How each role was recognised before migration 0010 gave categories a role.
const LEGACY_ROLE: [SystemRole, (c: RoleLike) => boolean][] = [
  ["salario", (c) => c.grp === "entrada" && /sal[áa]rio/i.test(c.name)],
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
