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
