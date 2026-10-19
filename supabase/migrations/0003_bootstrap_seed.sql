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
