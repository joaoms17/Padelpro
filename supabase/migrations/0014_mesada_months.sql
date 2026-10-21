-- Mesada por mês: o valor de cada pessoa pode mudar de mês para mês.
-- Sem linha para um mês, vale members.mesada_cents (o valor base).
-- Idempotente (ver 0007).
create table if not exists mesada_months (
  household_id uuid not null references households (id) on delete cascade,
  member_id uuid not null references members (id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  amount_cents bigint not null check (amount_cents >= 0),
  updated_at timestamptz not null default now(),
  primary key (member_id, month)
);

create index if not exists mesada_months_household_idx on mesada_months (household_id, month);

alter table mesada_months enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'mesada_months' and policyname = 'mesada_months_member'
  ) then
    create policy mesada_months_member on mesada_months for all
      using (household_id in (select current_households()))
      with check (household_id in (select current_households()));
  end if;
end
$$;
