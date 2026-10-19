import type { CategoryGroup } from "./types";

// Initial categories (section 6.1). Editable in the app; this list seeds a new
// household and mirrors supabase/migrations/0003_seed_categories.sql.
export interface SeedCategory {
  grp: CategoryGroup;
  name: string;
}

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
  { grp: "entrada", name: "Salário e extras João" },
  { grp: "entrada", name: "Renda casa arrendada" },
  { grp: "entrada", name: "Eventos Joana" },
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
  { grp: "variavel", name: "Combustível e carregamentos" },
  { grp: "variavel", name: "Transportes e portagens" },
  { grp: "variavel", name: "Casa e manutenção" },
  { grp: "variavel", name: "Saúde e farmácia" },
  { grp: "variavel", name: "Maggie" },
  { grp: "variavel", name: "Roupa e cuidado pessoal" },
  { grp: "variavel", name: "Lazer e concertos" },
  { grp: "variavel", name: "Viagens" },
  { grp: "variavel", name: "Prendas" },
  { grp: "variavel", name: "Outras variáveis" },
  // Atividade Joana
  { grp: "atividade", name: "Material" },
  { grp: "atividade", name: "Deslocações" },
  { grp: "atividade", name: "Alojamento em trabalho" },
  { grp: "atividade", name: "Outras despesas da atividade" },
  // Mesadas
  { grp: "mesada", name: "Mesada João" },
  { grp: "mesada", name: "Mesada Joana" },
  // Transferências internas
  { grp: "interna", name: "Entre contas" },
];
