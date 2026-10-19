-- Resumo semanal: domingo às 20:00 (spec 10). Aplicar à mão (contém secrets).
-- 19:00 UTC = 20:00 Lisboa no horário de verão. Substituir placeholders.

select cron.schedule(
  'weekly-summary',
  '0 19 * * 0',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{"type":"weekly"}'::jsonb
  );
  $$
);

-- Remover:  select cron.unschedule('weekly-summary');
