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
