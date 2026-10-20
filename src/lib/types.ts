// Shared domain types. Mirror the Supabase schema (supabase/migrations).
// Monetary fields are *_cents (integer cents); positive = entrada, negative = saída.

export type CategoryGroup =
  | "entrada"
  | "fixa"
  | "variavel"
  | "atividade"
  | "mesada"
  | "interna";

export type TransactionSource = "banco" | "applepay" | "manual" | "extrato";
export type TransactionStatus = "provisorio" | "confirmado";

export type AccountRole = "casa" | "outra";

export type EventType = "Noiva" | "Convidadas" | "Concerto" | "Outro" | string;
export type EventStatus =
  | "pedido"
  | "confirmado"
  | "realizado"
  | "pago"
  | "cancelado";

export type PaymentKind = "sinal" | "restante" | "outro";
export type PaymentMethod = "transferencia" | "mbway" | "numerario" | "revolut";
export type PaymentWhere = "conta_casa" | "por_transferir";

export interface Household {
  id: string;
  name: string;
  created_at: string;
}

export interface Member {
  id: string;
  household_id: string;
  user_id: string;
  display_name: string;
  mesada_cents: number;
  mesada_day: number | null;
  mesada_dest_iban_hash: string | null;
  notify_prefs: Record<string, boolean>;
}

export interface Account {
  id: string;
  household_id: string;
  name: string;
  role: AccountRole;
  iban_last4: string | null;
  eb_account_uid: string | null;
  eb_identification_hash: string | null;
  eb_last_sync_at: string | null;
  balance_cents: number;
  balance_at: string | null;
}

export interface Category {
  id: string;
  household_id: string;
  grp: CategoryGroup;
  name: string;
  icon: string | null;
  budget_cents: number | null;
  rollover: boolean;
  sort: number;
  archived: boolean;
}

export interface Transaction {
  id: string;
  household_id: string;
  account_id: string;
  source: TransactionSource;
  external_id: string | null;
  booking_date: string;
  value_date: string | null;
  amount_cents: number;
  description_raw: string | null;
  counterparty: string | null;
  merchant_clean: string | null;
  category_id: string | null;
  category_source: string | null;
  confidence: number | null;
  status: TransactionStatus;
  matched_transaction_id: string | null;
  note: string | null;
}

export interface EventRow {
  id: string;
  household_id: string;
  date: string;
  type: EventType;
  client_name: string | null;
  location: string | null;
  service_cents: number;
  expense_allowance_cents: number;
  km: number;
  expected_costs_cents: number;
  status: EventStatus;
  notes: string | null;
}

export interface Goal {
  id: string;
  household_id: string;
  name: string;
  target_cents: number;
  due_date: string | null;
  reserved_cents: number;
}

export interface Rule {
  id: string;
  household_id: string;
  field: "merchant" | "description" | "counterparty" | "iban";
  match_type: "equals" | "contains" | "regex";
  pattern: string;
  category_id: string;
  priority: number;
  created_by: string | null;
}

export interface BankConnection {
  id: string;
  household_id: string;
  aspsp_name: string;
  session_id: string | null;
  valid_until: string | null;
  status: string;
  last_sync_at: string | null;
  last_error: string | null;
}
