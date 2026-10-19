-- Contas a Dois — schema base (secção 13 da spec).
-- Valores monetários em cêntimos (bigint); positivos = entrada, negativos = saída.
-- Correr no SQL Editor do Supabase ou via `supabase db push`.

create extension if not exists pgcrypto;

-- ───────────────────────── Agregado e membros ─────────────────────────
create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  mesada_cents bigint not null default 0,
  mesada_day int check (mesada_day between 1 and 28),
  mesada_dest_iban_hash text,
  pin_hash text,
  notify_prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (household_id, user_id)
);

-- ───────────────────────── Contas ─────────────────────────
create table accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  name text not null,
  role text not null default 'casa' check (role in ('casa', 'outra')),
  iban_hash text,
  iban_last4 text,
  eb_account_uid text,
  balance_cents bigint not null default 0,
  balance_at timestamptz
);

create table bank_connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  aspsp_name text not null,
  session_id text,
  valid_until timestamptz,
  status text not null default 'pending',
  last_sync_at timestamptz,
  last_error text
);

-- ───────────────────────── Categorias ─────────────────────────
create table categories (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  grp text not null check (grp in ('entrada','fixa','variavel','atividade','mesada','interna')),
  name text not null,
  icon text,
  budget_cents bigint,
  rollover boolean not null default false,
  sort int not null default 0,
  archived boolean not null default false
);

-- ───────────────────────── Movimentos ─────────────────────────
create table transactions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  account_id uuid not null references accounts (id) on delete cascade,
  source text not null check (source in ('banco','applepay','manual','extrato')),
  external_id text,
  booking_date date not null,
  value_date date,
  amount_cents bigint not null,
  description_raw text,
  counterparty text,
  merchant_clean text,
  category_id uuid references categories (id) on delete set null,
  category_source text,
  confidence real,
  status text not null default 'confirmado' check (status in ('provisorio','confirmado')),
  matched_transaction_id uuid references transactions (id) on delete set null,
  recurring_id uuid,
  event_payment_id uuid,
  note text,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, external_id)
);

create index transactions_household_date_idx
  on transactions (household_id, booking_date desc);

create table transaction_splits (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions (id) on delete cascade,
  category_id uuid not null references categories (id) on delete cascade,
  amount_cents bigint not null
);

-- ───────────────────────── Regras e recorrências ─────────────────────────
create table rules (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  field text not null check (field in ('merchant','description','counterparty','iban')),
  match_type text not null check (match_type in ('equals','contains','regex')),
  pattern text not null,
  category_id uuid not null references categories (id) on delete cascade,
  priority int not null default 100,
  created_by uuid references auth.users (id)
);

create table recurring (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  counterparty_key text not null,
  category_id uuid references categories (id) on delete set null,
  expected_cents bigint not null,
  tolerance_cents bigint not null default 200,
  expected_day int,
  last_seen_at date,
  active boolean not null default true
);

-- ───────────────────────── Eventos da Joana ─────────────────────────
create table events (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  date date not null,
  type text not null,
  client_name text,
  location text,
  service_cents bigint not null default 0,
  expense_allowance_cents bigint not null default 0,
  km real not null default 0,
  expected_costs_cents bigint not null default 0,
  status text not null default 'pedido'
    check (status in ('pedido','confirmado','realizado','pago','cancelado')),
  notes text,
  created_at timestamptz not null default now()
);

create table event_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events (id) on delete cascade,
  kind text not null check (kind in ('sinal','restante','outro')),
  amount_cents bigint not null,
  received_at date,
  method text check (method in ('transferencia','mbway','numerario','revolut')),
  location text not null default 'por_transferir'
    check (location in ('conta_casa','por_transferir')),
  transaction_id uuid references transactions (id) on delete set null
);

create table joana_source_accounts (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  label text not null,
  iban_hash text,
  name_pattern text
);

-- ───────────────────────── Objetivos e definições ─────────────────────────
create table goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  name text not null,
  target_cents bigint not null,
  due_date date,
  reserved_cents bigint not null default 0
);

create table settings (
  household_id uuid primary key references households (id) on delete cascade,
  cushion_target_months real not null default 3,
  price_table jsonb not null default '{}'::jsonb
);

-- ───────────────────────── Ingestão e notificações ─────────────────────────
create table ingest_tokens (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members (id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table review_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  type text not null,
  ref jsonb not null default '{}'::jsonb,
  status text not null default 'aberto',
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table monthly_snapshots (
  household_id uuid not null references households (id) on delete cascade,
  month text not null, -- 'YYYY-MM'
  metrics jsonb not null default '{}'::jsonb,
  summary_text text,
  created_at timestamptz not null default now(),
  primary key (household_id, month)
);

-- Fixas: ligação do transaction.recurring_id (criada depois de recurring existir)
alter table transactions
  add constraint transactions_recurring_fk
  foreign key (recurring_id) references recurring (id) on delete set null;

alter table transactions
  add constraint transactions_event_payment_fk
  foreign key (event_payment_id) references event_payments (id) on delete set null;
