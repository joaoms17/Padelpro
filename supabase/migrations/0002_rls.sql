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
