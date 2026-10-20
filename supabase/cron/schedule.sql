-- Crons da app (pg_cron + pg_net). Idempotente: pode correr várias vezes.
-- Aplicado automaticamente pelo workflow "Supabase deploy", que substitui
-- <PROJECT_REF> e guarda o segredo dos crons no Vault (nome `cron_secret`).
-- Não contém chaves: o header x-cron-secret é lido do Vault em cada execução.
--
-- Horas em UTC. Lisboa = UTC+1 no verão (WEST) e UTC no inverno (WET).
--   eb-sync-morning / eb-sync-evening  06:00 e 18:00  sincronizar o banco
--   daily-alerts                       08:30          consentimento do banco a expirar
--   monthly-close                      dia 1, 08:00   fecho do mês + resumo IA
--   weekly-summary                     domingo 19:00  resumo semanal (push)
--   cron-cleanup                       domingo 03:00  limpa o histórico dos crons

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Schema fora da API pública (o PostgREST só expõe `public`).
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.call_edge_function(fn text, payload jsonb default '{}'::jsonb)
returns bigint
language sql
as $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/' || fn,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := payload,
    timeout_milliseconds := 150000
  );
$$;
revoke all on function private.call_edge_function(text, jsonb) from public, anon, authenticated;

select cron.schedule('eb-sync-morning', '0 6 * * *',  $$select private.call_edge_function('eb-sync')$$);
select cron.schedule('eb-sync-evening', '0 18 * * *', $$select private.call_edge_function('eb-sync')$$);
select cron.schedule('daily-alerts',    '30 8 * * *', $$select private.call_edge_function('alerts')$$);
select cron.schedule('monthly-close',   '0 8 1 * *',  $$select private.call_edge_function('monthly-close')$$);
select cron.schedule('weekly-summary',  '0 19 * * 0', $$select private.call_edge_function('notify', '{"type":"weekly"}'::jsonb)$$);

-- O histórico do pg_cron nunca é limpo sozinho.
select cron.schedule('cron-cleanup', '0 3 * * 0',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$);

-- Ver:     select jobname, schedule, active from cron.job;
-- Últimas: select * from cron.job_run_details order by start_time desc limit 20;
--          select id, status_code, left(content, 200) from net._http_response order by id desc limit 20;
-- Remover: select cron.unschedule('eb-sync-morning');  (etc.)
