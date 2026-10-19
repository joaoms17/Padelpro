-- Fecho do mês: no dia 1 às 09:00 (spec 8). Gera um monthly_snapshot por
-- agregado com as métricas do mês anterior. Aplicar à mão (contém secrets).
--
-- Pré-requisitos: extensões pg_cron e pg_net ativas; substituir <PROJECT_REF>
-- e <SERVICE_ROLE_KEY>. 08:00 UTC = 09:00 Lisboa no horário de verão.

select cron.schedule(
  'monthly-close',
  '0 8 1 * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/monthly-close',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Remover:  select cron.unschedule('monthly-close');
