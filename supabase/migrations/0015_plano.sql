-- Plano e categorias simples.
--  • Movimentos "pontuais" (prémio, uma compra única) ficam fora das médias.
--  • As despesas de representação passam a ter um papel próprio
--    (system_role 'representacao'), como o ordenado e a renda.
--  • Cada entrada prevista diz o que é (kind): ordenado, representação,
--    renda ou outra.
--  • settings.plan guarda o plano do casal (Joana, poupança, mesadas, início);
--    settings.alerts_sent os avisos já enviados (um por mês e por motivo).
--  • Uma vez: as categorias passam a um conjunto curto (fusões com
--    merge_category, para os movimentos e regras seguirem para a nova).
-- Idempotente — aplicada pelo workflow "Supabase deploy" (ver 0007).

alter table transactions add column if not exists pontual boolean not null default false;

alter table categories drop constraint if exists categories_system_role_check;
alter table categories add constraint categories_system_role_check
  check (system_role in ('salario', 'representacao', 'renda', 'eventos', 'mesada'));

-- Um só ordenado, representação, renda e eventos por agregado.
drop index if exists categories_system_role_unique;
create unique index if not exists categories_system_role_one
  on categories (household_id, system_role)
  where system_role in ('salario', 'representacao', 'renda', 'eventos') and not archived;

-- Unset (null) = guessed from the name by the app.
alter table expected_incomes add column if not exists kind text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'expected_incomes_kind_check') then
    alter table expected_incomes add constraint expected_incomes_kind_check
      check (kind in ('salario', 'representacao', 'renda', 'outra'));
  end if;
end
$$;

alter table settings add column if not exists plan jsonb not null default '{}'::jsonb;
alter table settings add column if not exists alerts_sent jsonb not null default '{}'::jsonb;

-- Uma vez: o tipo das entradas que já existem, pelo nome.
do $$
begin
  if not exists (select 1 from app_patches where id = '0015_income_kind') then
    update expected_incomes
    set kind = case
      when label ~* '(ordenado|sal[áa]rio|vencimento)' then 'salario'
      when label ~* '(despesa|represent)' then 'representacao'
      when label ~* 'renda' then 'renda'
    end
    where kind is null;
    insert into app_patches (id) values ('0015_income_kind');
  end if;
end
$$;

-- Uma vez: o conjunto curto de categorias. Para cada uma: usa a que já tem
-- esse nome (ou o papel); senão dá esse nome à primeira das antigas que
-- existir; senão cria-a. As outras antigas da lista fundem-se nela.
-- Categorias criadas pelo casal (fora da lista) ficam, no fim do separador.
do $$
declare
  h record;
  s record;
  v_target uuid;
  v_src uuid;
  v_old text;
  v_touched uuid[];
  v_base int;
begin
  if exists (select 1 from app_patches where id = '0015_simple_categories') then
    return;
  end if;

  for h in select id from households loop
    v_touched := array[]::uuid[];

    for s in
      select * from (values
        ('entrada',   'Ordenado João',              10,   'salario',       array['Salário e extras João']),
        ('entrada',   'Despesas de representação',  20,   'representacao', array['Despesas de representação', 'Despesas João', 'Despesas Joao']),
        ('entrada',   'Renda casa arrendada',       30,   'renda',         array[]::text[]),
        ('entrada',   'Eventos Joana',              40,   'eventos',       array[]::text[]),
        ('entrada',   'Outras entradas',            50,   null,            array['Reembolsos']),
        ('fixa',      'Prestação casa',             1010, null,            array['Crédito habitação e prestações']),
        ('fixa',      'Prestação casa arrendada',   1020, null,            array[]::text[]),
        ('fixa',      'Luz, água, gás e internet',  1030, null,            array['Luz', 'Água', 'Gás', 'Internet e telemóvel']),
        ('fixa',      'Seguros',                    1040, null,            array[]::text[]),
        ('fixa',      'Subscrições',                1050, null,            array[]::text[]),
        ('fixa',      'Condomínio, IMI e outras',   1060, null,            array['Condomínio', 'Impostos da casa (IMI, IUC)', 'Outras fixas']),
        ('variavel',  'Supermercado',               2010, null,            array[]::text[]),
        ('variavel',  'Restaurantes e cafés',       2020, null,            array['Restaurantes e saídas']),
        ('variavel',  'Uber Eats e entregas',       2030, null,            array[]::text[]),
        ('variavel',  'Compras online',             2040, null,            array[]::text[]),
        ('variavel',  'Nutrição e suplementos',     2050, null,            array[]::text[]),
        ('variavel',  'Carro e transportes',        2060, null,            array['Combustível e carregamentos', 'Transportes e portagens']),
        ('variavel',  'Saúde e farmácia',           2070, null,            array[]::text[]),
        ('variavel',  'Maggie',                     2080, null,            array[]::text[]),
        ('variavel',  'Viagens e lazer',            2090, null,            array['Viagens', 'Lazer e concertos']),
        ('variavel',  'Casa e outras compras',      2100, null,            array['Outras variáveis', 'Casa e manutenção', 'Roupa e cuidado pessoal', 'Prendas']),
        ('atividade', 'Trabalho da Joana',          3010, null,            array['Material', 'Deslocações', 'Alojamento em trabalho', 'Outras despesas da atividade']),
        ('mesada',    'Para o João',                4010, null,            array['Mesada João']),
        ('mesada',    'Para a Joana',               4020, null,            array['Mesada Joana']),
        ('interna',   'Poupança',                   5010, null,            array['Entre contas'])
      ) as t(grp, target, sort, role, sources)
    loop
      v_target := null;

      -- Categories the app's calculations use are found by their role.
      if s.role is not null then
        select id, name into v_target, v_old from categories
        where household_id = h.id and system_role = s.role and not archived
        order by sort, id limit 1;
        -- Only the app's own old name is replaced; a name the couple chose stays.
        if v_target is not null and v_old = any (s.sources) then
          update categories set name = s.target where id = v_target;
        end if;
      end if;

      if v_target is null then
        select id into v_target from categories
        where household_id = h.id and grp = s.grp and not archived
          and lower(trim(name)) = lower(s.target)
        order by sort, id limit 1;
      end if;

      if v_target is null then
        select c.id into v_target
        from unnest(s.sources) with ordinality as src(name, n)
        join categories c
          on c.household_id = h.id and c.grp = s.grp and not c.archived
         and lower(trim(c.name)) = lower(src.name)
         and (c.system_role is null or c.system_role = coalesce(s.role, c.system_role))
        order by src.n, c.sort, c.id limit 1;
        if v_target is not null then
          update categories set name = s.target where id = v_target;
        end if;
      end if;

      -- Moved to another group by the couple: bring it back instead of
      -- creating a second one with the same name.
      if v_target is null then
        select c.id into v_target from categories c
        where c.household_id = h.id and not c.archived and c.system_role is null
          and lower(trim(c.name)) in (select lower(x) from unnest(s.sources || s.target) as x)
        order by (lower(trim(c.name)) = lower(s.target)) desc, c.sort, c.id limit 1;
        if v_target is not null then
          update categories set name = s.target, grp = s.grp where id = v_target;
        end if;
      end if;

      if v_target is null then
        insert into categories (household_id, grp, name, sort, system_role)
        values (h.id, s.grp, s.target, s.sort, s.role)
        returning id into v_target;
      end if;

      update categories
      set sort = s.sort,
          system_role = coalesce(s.role, system_role)
      where id = v_target;

      -- The other old ones join it (their movements, rules and budget too).
      -- Any group: one moved elsewhere joins too; so does a second category
      -- with the target's own name.
      for v_src in
        select c.id
        from categories c
        where c.household_id = h.id and not c.archived
          and c.id <> v_target and c.system_role is null
          and lower(trim(c.name)) in (select lower(x) from unnest(s.sources || s.target) as x)
      loop
        perform merge_category(v_src, v_target);
      end loop;

      v_touched := v_touched || v_target;
    end loop;

    -- The couple's own categories go after the app's, in their order.
    for s in
      select c.id, c.grp, row_number() over (partition by c.grp order by c.sort, c.id) as n
      from categories c
      where c.household_id = h.id and not c.archived and not (c.id = any (v_touched))
    loop
      v_base := case s.grp
        when 'entrada' then 0 when 'fixa' then 1000 when 'variavel' then 2000
        when 'atividade' then 3000 when 'mesada' then 4000 else 5000 end;
      update categories set sort = v_base + 500 + s.n * 10 where id = s.id;
    end loop;
  end loop;

  insert into app_patches (id) values ('0015_simple_categories');
end
$$;

-- Agregados novos: o seed já traz o conjunto curto.
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
    (p_household,'entrada','Ordenado João',10,'salario'),
    (p_household,'entrada','Despesas de representação',20,'representacao'),
    (p_household,'entrada','Renda casa arrendada',30,'renda'),
    (p_household,'entrada','Eventos Joana',40,'eventos'),
    (p_household,'entrada','Outras entradas',50,null),
    (p_household,'fixa','Prestação casa',1010,null),
    (p_household,'fixa','Prestação casa arrendada',1020,null),
    (p_household,'fixa','Luz, água, gás e internet',1030,null),
    (p_household,'fixa','Seguros',1040,null),
    (p_household,'fixa','Subscrições',1050,null),
    (p_household,'fixa','Condomínio, IMI e outras',1060,null),
    (p_household,'variavel','Supermercado',2010,null),
    (p_household,'variavel','Restaurantes e cafés',2020,null),
    (p_household,'variavel','Uber Eats e entregas',2030,null),
    (p_household,'variavel','Compras online',2040,null),
    (p_household,'variavel','Nutrição e suplementos',2050,null),
    (p_household,'variavel','Carro e transportes',2060,null),
    (p_household,'variavel','Saúde e farmácia',2070,null),
    (p_household,'variavel','Maggie',2080,null),
    (p_household,'variavel','Viagens e lazer',2090,null),
    (p_household,'variavel','Casa e outras compras',2100,null),
    (p_household,'atividade','Trabalho da Joana',3010,null),
    (p_household,'mesada','Para o João',4010,'mesada'),
    (p_household,'mesada','Para a Joana',4020,'mesada'),
    (p_household,'interna','Poupança',5010,null);
end $$;
