-- Contas a Dois — setup completo da base de dados.
-- Colar tudo de uma vez no SQL Editor do Supabase (projeto novo e vazio).
-- Equivale a correr supabase/migrations/0001 … 0011 por ordem.

-- ============================================================
-- supabase/migrations/0001_schema.sql
-- ============================================================
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

-- ============================================================
-- supabase/migrations/0002_rls.sql
-- ============================================================
-- Contas a Dois — Row-Level Security (secção 3 e 12 da spec).
-- Só membros do agregado leem/escrevem as linhas com o seu household_id.

-- Helpers em SECURITY DEFINER para evitar recursão de RLS na tabela members.
create or replace function public.current_households()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select household_id from members where user_id = auth.uid();
$$;

create or replace function public.current_member_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select id from members where user_id = auth.uid();
$$;

-- Ativar RLS em tudo.
alter table households            enable row level security;
alter table members               enable row level security;
alter table accounts              enable row level security;
alter table bank_connections      enable row level security;
alter table categories            enable row level security;
alter table transactions          enable row level security;
alter table transaction_splits    enable row level security;
alter table rules                 enable row level security;
alter table recurring             enable row level security;
alter table events                enable row level security;
alter table event_payments        enable row level security;
alter table joana_source_accounts enable row level security;
alter table goals                 enable row level security;
alter table settings              enable row level security;
alter table ingest_tokens         enable row level security;
alter table push_subscriptions    enable row level security;
alter table review_items          enable row level security;
alter table monthly_snapshots     enable row level security;

-- households: membro vê/edita o seu agregado.
create policy households_member on households
  for all using (id in (select current_households()))
  with check (id in (select current_households()));

-- members: ver/editar membros dos próprios agregados.
create policy members_member on members
  for all using (household_id in (select current_households()))
  with check (household_id in (select current_households()));

-- Tabelas com household_id direto: um policy genérico.
do $$
declare t text;
begin
  foreach t in array array[
    'accounts','bank_connections','categories','transactions','rules',
    'recurring','events','joana_source_accounts','goals','settings',
    'review_items','monthly_snapshots'
  ]
  loop
    execute format(
      'create policy %I_member on %I for all ' ||
      'using (household_id in (select current_households())) ' ||
      'with check (household_id in (select current_households()));',
      t, t
    );
  end loop;
end $$;

-- transaction_splits: via transação-pai.
create policy splits_member on transaction_splits
  for all using (
    exists (
      select 1 from transactions x
      where x.id = transaction_id
        and x.household_id in (select current_households())
    )
  )
  with check (
    exists (
      select 1 from transactions x
      where x.id = transaction_id
        and x.household_id in (select current_households())
    )
  );

-- event_payments: via evento-pai.
create policy event_payments_member on event_payments
  for all using (
    exists (
      select 1 from events e
      where e.id = event_id
        and e.household_id in (select current_households())
    )
  )
  with check (
    exists (
      select 1 from events e
      where e.id = event_id
        and e.household_id in (select current_households())
    )
  );

-- ingest_tokens e push_subscriptions: via member do próprio utilizador.
create policy ingest_tokens_member on ingest_tokens
  for all using (member_id in (select current_member_ids()))
  with check (member_id in (select current_member_ids()));

create policy push_subscriptions_member on push_subscriptions
  for all using (member_id in (select current_member_ids()))
  with check (member_id in (select current_member_ids()));

-- ============================================================
-- supabase/migrations/0003_bootstrap_seed.sql
-- ============================================================
-- Contas a Dois — bootstrap do agregado e categorias iniciais.
-- App de casal: um único agregado com no máximo 2 membros (João e Joana).

-- Semear as categorias iniciais (secção 6.1). Idempotente por agregado.
create or replace function public.seed_default_categories(p_household uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if exists (select 1 from categories where household_id = p_household) then
    return;
  end if;

  insert into categories (household_id, grp, name, sort)
  values
    (p_household,'entrada','Salário e extras João',10),
    (p_household,'entrada','Renda casa arrendada',20),
    (p_household,'entrada','Eventos Joana',30),
    (p_household,'entrada','Reembolsos',40),
    (p_household,'entrada','Outras entradas',50),
    (p_household,'fixa','Crédito habitação e prestações',110),
    (p_household,'fixa','Condomínio',120),
    (p_household,'fixa','Luz',130),
    (p_household,'fixa','Água',140),
    (p_household,'fixa','Gás',150),
    (p_household,'fixa','Internet e telemóvel',160),
    (p_household,'fixa','Seguros',170),
    (p_household,'fixa','Subscrições',180),
    (p_household,'fixa','Impostos da casa (IMI, IUC)',190),
    (p_household,'fixa','Outras fixas',200),
    (p_household,'variavel','Supermercado',210),
    (p_household,'variavel','Restaurantes e saídas',220),
    (p_household,'variavel','Combustível e carregamentos',230),
    (p_household,'variavel','Transportes e portagens',240),
    (p_household,'variavel','Casa e manutenção',250),
    (p_household,'variavel','Saúde e farmácia',260),
    (p_household,'variavel','Maggie',270),
    (p_household,'variavel','Roupa e cuidado pessoal',280),
    (p_household,'variavel','Lazer e concertos',290),
    (p_household,'variavel','Viagens',300),
    (p_household,'variavel','Prendas',310),
    (p_household,'variavel','Outras variáveis',320),
    (p_household,'atividade','Material',410),
    (p_household,'atividade','Deslocações',420),
    (p_household,'atividade','Alojamento em trabalho',430),
    (p_household,'atividade','Outras despesas da atividade',440),
    (p_household,'mesada','Mesada João',510),
    (p_household,'mesada','Mesada Joana',520),
    (p_household,'interna','Entre contas',610);
end $$;

-- Garante que o utilizador autenticado tem um member. Cria o agregado na
-- primeira utilização (João) e deixa o segundo utilizador (Joana) juntar-se.
-- Limita a 2 membros.
create or replace function public.ensure_membership(p_display text)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_household uuid;
  v_count int;
begin
  if v_uid is null then
    raise exception 'não autenticado';
  end if;

  -- Já é membro?
  select household_id into v_household from members where user_id = v_uid limit 1;
  if v_household is not null then
    return v_household;
  end if;

  -- Existe exatamente um agregado? Junta-se (se houver lugar).
  select count(*) into v_count from households;
  if v_count = 1 then
    select id into v_household from households limit 1;
    if (select count(*) from members where household_id = v_household) >= 2 then
      raise exception 'o agregado já tem 2 membros';
    end if;
  elsif v_count = 0 then
    insert into households (name) values ('Casa') returning id into v_household;
    perform seed_default_categories(v_household);
    insert into settings (household_id) values (v_household)
      on conflict do nothing;
    -- Conta Casa por omissão.
    insert into accounts (household_id, name, role)
      values (v_household, 'Conta Casa', 'casa');
  else
    raise exception 'vários agregados existem; junção ambígua';
  end if;

  insert into members (household_id, user_id, display_name)
    values (v_household, v_uid, coalesce(nullif(trim(p_display), ''), 'Membro'));

  return v_household;
end $$;

grant execute on function public.ensure_membership(text) to authenticated;

-- ============================================================
-- supabase/migrations/0004_bank.sql
-- ============================================================
-- M3 — Enable Banking (Santander) support.

-- Short-lived authorization requests (CSRF state → household). Only the
-- service role (Edge Functions) touches this; RLS on with no policies blocks
-- all client access.
create table eb_auth_requests (
  state uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table eb_auth_requests enable row level security;

-- One active bank connection per household (upsert target for eb-callback).
alter table bank_connections
  add constraint bank_connections_household_unique unique (household_id);

-- ============================================================
-- supabase/migrations/0005_push.sql
-- ============================================================
-- M9 — Web Push.
-- Unique endpoint so a device re-subscribing upserts instead of duplicating.
alter table push_subscriptions
  add constraint push_subscriptions_endpoint_unique unique (endpoint);

-- ============================================================
-- supabase/migrations/0006_tax_rate.sql
-- ============================================================
-- Extra — reserva para impostos da atividade (secção 18, taxa configurável).
alter table settings
  add column if not exists tax_rate real not null default 0;

-- ============================================================
-- supabase/migrations/0007_eb_identification.sql
-- ============================================================
-- Enable Banking: a new consent (every ~180 days) brings new account uids;
-- identification_hash stays stable across sessions and is what eb-callback
-- matches on, so renewals never duplicate accounts or history.
-- eb_last_sync_at: each account's own sync window (a never-synced account
-- gets its full history, even when added on a renewal).
-- Idempotent — from 0007 on, the "Supabase deploy" workflow applies every
-- migration on each run, so each one must be safe to re-run.
alter table accounts
  add column if not exists eb_identification_hash text;

create unique index if not exists accounts_eb_identification_unique
  on accounts (household_id, eb_identification_hash)
  where eb_identification_hash is not null;

-- Added once; accounts that were already syncing keep their incremental
-- window (the backfill must not run again on later deploys).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'accounts' and column_name = 'eb_last_sync_at'
  ) then
    alter table accounts add column eb_last_sync_at timestamptz;
    update accounts a
    set eb_last_sync_at = bc.last_sync_at
    from bank_connections bc
    where a.household_id = bc.household_id
      and a.eb_account_uid is not null
      and bc.last_sync_at is not null;
  end if;
end
$$;

-- ============================================================
-- supabase/migrations/0008_more_categories.sql
-- ============================================================
-- Novas categorias variáveis: "Compras online" e "Uber Eats e entregas"
-- (separada de "Restaurantes e saídas"). Idempotente — aplicada pelo workflow
-- "Supabase deploy" em cada execução (ver 0007).

-- Correções de dados que só podem correr uma vez (o workflow volta a aplicar
-- todas as migrações em cada deploy): cada uma fica aqui registada.
create table if not exists app_patches (
  id text primary key,
  applied_at timestamptz not null default now()
);
-- Só para o servidor: sem políticas, nenhum utilizador da app lhe acede.
alter table app_patches enable row level security;

-- Agregados existentes: acrescenta só as que faltam — uma vez, para não as
-- recriar se depois as mudarem de nome ou removerem.
do $$
begin
  if not exists (select 1 from app_patches where id = '0008_more_categories') then
    insert into categories (household_id, grp, name, sort)
    select h.id, 'variavel', v.name, v.sort
    from households h
    cross join (values ('Uber Eats e entregas', 225), ('Compras online', 315)) as v(name, sort)
    where not exists (
      select 1 from categories c
      where c.household_id = h.id and lower(c.name) = lower(v.name)
    );
    insert into app_patches (id) values ('0008_more_categories');
  end if;
end
$$;

-- Agregados novos: o seed passa a incluí-las.
create or replace function public.seed_default_categories(p_household uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if exists (select 1 from categories where household_id = p_household) then
    return;
  end if;

  insert into categories (household_id, grp, name, sort)
  values
    (p_household,'entrada','Salário e extras João',10),
    (p_household,'entrada','Renda casa arrendada',20),
    (p_household,'entrada','Eventos Joana',30),
    (p_household,'entrada','Reembolsos',40),
    (p_household,'entrada','Outras entradas',50),
    (p_household,'fixa','Crédito habitação e prestações',110),
    (p_household,'fixa','Condomínio',120),
    (p_household,'fixa','Luz',130),
    (p_household,'fixa','Água',140),
    (p_household,'fixa','Gás',150),
    (p_household,'fixa','Internet e telemóvel',160),
    (p_household,'fixa','Seguros',170),
    (p_household,'fixa','Subscrições',180),
    (p_household,'fixa','Impostos da casa (IMI, IUC)',190),
    (p_household,'fixa','Outras fixas',200),
    (p_household,'variavel','Supermercado',210),
    (p_household,'variavel','Restaurantes e saídas',220),
    (p_household,'variavel','Uber Eats e entregas',225),
    (p_household,'variavel','Combustível e carregamentos',230),
    (p_household,'variavel','Transportes e portagens',240),
    (p_household,'variavel','Casa e manutenção',250),
    (p_household,'variavel','Saúde e farmácia',260),
    (p_household,'variavel','Maggie',270),
    (p_household,'variavel','Roupa e cuidado pessoal',280),
    (p_household,'variavel','Lazer e concertos',290),
    (p_household,'variavel','Viagens',300),
    (p_household,'variavel','Prendas',310),
    (p_household,'variavel','Compras online',315),
    (p_household,'variavel','Outras variáveis',320),
    (p_household,'atividade','Material',410),
    (p_household,'atividade','Deslocações',420),
    (p_household,'atividade','Alojamento em trabalho',430),
    (p_household,'atividade','Outras despesas da atividade',440),
    (p_household,'mesada','Mesada João',510),
    (p_household,'mesada','Mesada Joana',520),
    (p_household,'interna','Entre contas',610);
end $$;

-- ============================================================
-- supabase/migrations/0009_group_labels.sql
-- ============================================================
-- Nomes dos separadores (grupos de categorias) editáveis por agregado:
-- {"variavel": "Dia a dia", ...}; vazio = nomes por omissão da app.
-- Idempotente — aplicada pelo workflow "Supabase deploy" (ver 0007).
alter table settings
  add column if not exists group_labels jsonb not null default '{}'::jsonb;

-- ============================================================
-- supabase/migrations/0010_category_roles.sql
-- ============================================================
-- Categorias que a app usa nos cálculos passam a ter um papel fixo
-- (system_role) em vez de serem reconhecidas pelo nome: salário e renda
-- (base fixa), eventos (pagamentos de eventos) e mesadas. Mudar o nome de
-- outra categoria, ou criar uma nova, já não mexe nas contas.
-- Remover uma categoria passa a ser uma fusão (merge_category) numa só
-- transação: fica arquivada a apontar para onde foi (merged_into), e um
-- trigger reencaminha qualquer escrita que ainda chegue com o id antigo
-- (ex.: o telemóvel da outra pessoa com a lista antiga aberta).
-- Idempotente — aplicada pelo workflow "Supabase deploy" (ver 0007 e 0008).

alter table categories add column if not exists system_role text;
alter table categories
  add column if not exists merged_into uuid references categories (id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'categories_system_role_check') then
    alter table categories add constraint categories_system_role_check
      check (system_role in ('salario', 'renda', 'eventos', 'mesada'));
  end if;
end
$$;

-- Um só salário, renda e eventos por agregado (mesadas: uma por pessoa).
create unique index if not exists categories_system_role_unique
  on categories (household_id, system_role)
  where system_role in ('salario', 'renda', 'eventos') and not archived;

-- Uma vez: dar o papel às categorias que até aqui eram reconhecidas pelo nome.
do $$
begin
  if not exists (select 1 from app_patches where id = '0010_system_roles') then
    update categories c
    set system_role = v.role
    from (
      select distinct on (household_id, role) id, role
      from (
        select id, household_id, sort,
          case
            when name ~* 'sal[áa]rio' then 'salario'
            when name ~* 'renda casa' then 'renda'
            when name ~* 'eventos' then 'eventos'
          end as role
        from categories
        where grp = 'entrada' and not archived and system_role is null
      ) x
      where role is not null
        and not exists (
          select 1 from categories o
          where o.household_id = x.household_id and o.system_role = x.role and not o.archived
        )
      order by household_id, role, sort, id
    ) v
    where c.id = v.id;

    update categories
    set system_role = 'mesada'
    where grp = 'mesada' and not archived and system_role is null;

    insert into app_patches (id) values ('0010_system_roles');
  end if;
end
$$;

-- Uma escrita com uma categoria arquivada segue para onde ela foi fundida.
-- Sem destino: o movimento fica por categorizar; regras e divisões recusam.
create or replace function public.remap_archived_category()
  returns trigger
  language plpgsql
  set search_path = public
as $$
declare
  v_id uuid := new.category_id;
  v_archived boolean;
  v_next uuid;
  v_hops int := 0;
begin
  if v_id is null then
    return new;
  end if;
  loop
    select archived, merged_into into v_archived, v_next from categories where id = v_id;
    exit when not found or not v_archived;
    if v_next is null or v_hops >= 10 then
      v_id := null;
      exit;
    end if;
    v_id := v_next;
    v_hops := v_hops + 1;
  end loop;

  if v_id is null and tg_table_name in ('rules', 'transaction_splits') then
    raise exception 'Essa categoria foi removida — escolhe outra.' using errcode = '23503';
  end if;
  new.category_id := v_id;
  return new;
end
$$;

do $$
declare t text;
begin
  foreach t in array array['transactions', 'transaction_splits', 'rules', 'recurring']
  loop
    execute format('drop trigger if exists %I on %I', t || '_remap_archived_category', t);
    execute format(
      'create trigger %I before insert or update of category_id on %I ' ||
      'for each row execute function public.remap_archived_category()',
      t || '_remap_archived_category', t
    );
  end loop;
end
$$;

-- Remover p_from: tudo o que a usava passa para p_to, o orçamento soma-se ao
-- de p_to quando ficam no mesmo separador, e p_from fica arquivada.
-- Corre com as permissões de quem chama (RLS: só o próprio agregado).
create or replace function public.merge_category(p_from uuid, p_to uuid)
  returns void
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  v_from categories%rowtype;
  v_to categories%rowtype;
begin
  if p_from = p_to then
    raise exception 'Escolhe outra categoria para os movimentos.';
  end if;
  select * into v_from from categories where id = p_from for update;
  select * into v_to from categories where id = p_to for update;
  if v_from.id is null or v_to.id is null or v_from.household_id <> v_to.household_id then
    raise exception 'Categoria não encontrada.';
  end if;
  if v_from.archived then
    raise exception 'Essa categoria já foi removida.';
  end if;
  if v_to.archived then
    raise exception 'A categoria de destino foi removida — escolhe outra.';
  end if;
  if v_from.system_role is not null then
    raise exception 'A app usa esta categoria nos cálculos — não pode ser removida.';
  end if;

  update categories
  set archived = true, merged_into = p_to, budget_cents = null
  where id = p_from;
  -- Fusões anteriores para p_from passam a apontar já para p_to.
  update categories set merged_into = p_to where merged_into = p_from;

  if v_from.grp = v_to.grp and coalesce(v_from.budget_cents, 0) > 0 then
    update categories
    set budget_cents = coalesce(budget_cents, 0) + v_from.budget_cents
    where id = p_to;
  end if;

  update transactions set category_id = p_to where category_id = p_from;
  update transaction_splits set category_id = p_to where category_id = p_from;
  update rules set category_id = p_to where category_id = p_from;
  update recurring set category_id = p_to where category_id = p_from;
end
$$;

revoke all on function public.merge_category(uuid, uuid) from public, anon;
grant execute on function public.merge_category(uuid, uuid) to authenticated;

-- Agregados novos: o seed já traz os papéis.
create or replace function public.seed_default_categories(p_household uuid)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if exists (select 1 from categories where household_id = p_household) then
    return;
  end if;

  insert into categories (household_id, grp, name, sort, system_role)
  values
    (p_household,'entrada','Salário e extras João',10,'salario'),
    (p_household,'entrada','Renda casa arrendada',20,'renda'),
    (p_household,'entrada','Eventos Joana',30,'eventos'),
    (p_household,'entrada','Reembolsos',40,null),
    (p_household,'entrada','Outras entradas',50,null),
    (p_household,'fixa','Crédito habitação e prestações',110,null),
    (p_household,'fixa','Condomínio',120,null),
    (p_household,'fixa','Luz',130,null),
    (p_household,'fixa','Água',140,null),
    (p_household,'fixa','Gás',150,null),
    (p_household,'fixa','Internet e telemóvel',160,null),
    (p_household,'fixa','Seguros',170,null),
    (p_household,'fixa','Subscrições',180,null),
    (p_household,'fixa','Impostos da casa (IMI, IUC)',190,null),
    (p_household,'fixa','Outras fixas',200,null),
    (p_household,'variavel','Supermercado',210,null),
    (p_household,'variavel','Restaurantes e saídas',220,null),
    (p_household,'variavel','Uber Eats e entregas',225,null),
    (p_household,'variavel','Combustível e carregamentos',230,null),
    (p_household,'variavel','Transportes e portagens',240,null),
    (p_household,'variavel','Casa e manutenção',250,null),
    (p_household,'variavel','Saúde e farmácia',260,null),
    (p_household,'variavel','Maggie',270,null),
    (p_household,'variavel','Roupa e cuidado pessoal',280,null),
    (p_household,'variavel','Lazer e concertos',290,null),
    (p_household,'variavel','Viagens',300,null),
    (p_household,'variavel','Prendas',310,null),
    (p_household,'variavel','Compras online',315,null),
    (p_household,'variavel','Outras variáveis',320,null),
    (p_household,'atividade','Material',410,null),
    (p_household,'atividade','Deslocações',420,null),
    (p_household,'atividade','Alojamento em trabalho',430,null),
    (p_household,'atividade','Outras despesas da atividade',440,null),
    (p_household,'mesada','Mesada João',510,'mesada'),
    (p_household,'mesada','Mesada Joana',520,'mesada'),
    (p_household,'interna','Entre contas',610,null);
end $$;

-- ============================================================
-- supabase/migrations/0011_expected_incomes.sql
-- ============================================================
-- Entradas previstas: o que costuma entrar na conta e quando (ordenado ao
-- dia 23, despesas de representação de 2 em 2 meses em 2 transferências…),
-- para a previsão do fim do mês. Uma entrada conta como recebida quando
-- chegam movimentos com a palavra-chave e um valor próximo de cada parte.
-- Idempotente — aplicada pelo workflow "Supabase deploy" (ver 0007).
create table if not exists expected_incomes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households (id) on delete cascade,
  label text not null,
  amount_cents bigint not null check (amount_cents > 0),   -- total no mês em que cai
  parts smallint not null default 1 check (parts between 1 and 10), -- em quantas transferências
  day smallint not null default 1 check (day between 1 and 31),
  every_months smallint not null default 1 check (every_months between 1 and 12),
  anchor_month date not null,                               -- um mês em que cai (dia 1)
  match_text text,                                          -- palavra-chave na descrição
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists expected_incomes_household_idx on expected_incomes (household_id);

alter table expected_incomes enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'expected_incomes' and policyname = 'expected_incomes_member'
  ) then
    create policy expected_incomes_member on expected_incomes for all
      using (household_id in (select current_households()))
      with check (household_id in (select current_households()));
  end if;
end
$$;
