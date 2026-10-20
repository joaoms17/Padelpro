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
