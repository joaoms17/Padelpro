-- Agenda a sincronização do banco 2×/dia (spec 4.1).
-- NÃO corre automaticamente nas migrações: contém o service-role key, por isso
-- é aplicado à mão no SQL Editor depois de substituíres os placeholders.
--
-- Passos:
--   1. No dashboard do Supabase: Database → Extensions → ativar `pg_cron` e `pg_net`.
--   2. Substituir <PROJECT_REF> e <SERVICE_ROLE_KEY> abaixo.
--   3. Correr este ficheiro no SQL Editor.
--
-- Horas: pg_cron corre em UTC. 06:00 e 18:00 UTC = 07:00/19:00 em Lisboa no
-- horário de verão (WEST). No inverno (WET=UTC) ficam às 06:00/18:00 — ajusta
-- para 07:00/19:00 UTC se preferires a hora de inverno exata.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'eb-sync-morning',
  '0 6 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/eb-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'eb-sync-evening',
  '0 18 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/eb-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Para remover:
--   select cron.unschedule('eb-sync-morning');
--   select cron.unschedule('eb-sync-evening');
