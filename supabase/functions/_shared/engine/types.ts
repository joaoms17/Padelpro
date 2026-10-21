// The shapes the engine reads, structurally (Edge Functions cannot import
// from src/). They mirror src/lib/types.ts and the schema; the app passes its
// full rows, which have these fields and more.

export type CategoryGroup = "entrada" | "fixa" | "variavel" | "atividade" | "mesada" | "interna";

export type SystemRole = "salario" | "representacao" | "renda" | "eventos" | "mesada";

export type TransactionSource = "banco" | "applepay" | "manual" | "extrato";

export interface Category {
  id: string;
  grp: CategoryGroup;
  name: string;
  budget_cents: number | null;
  sort: number;
  archived: boolean;
  /** Role in the app's calculations (migration 0010). */
  system_role?: SystemRole | null;
  /** Where an archived (removed) category's movements went. */
  merged_into?: string | null;
}

export interface Member {
  id: string;
  display_name: string;
  /** The base mesada (cents); a month can override it (mesada_months). */
  mesada_cents: number;
}
