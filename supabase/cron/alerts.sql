-- Alertas diários (spec 10): consentimento a expirar, eventos por transferir
-- 7+ dias, almofada abaixo do alvo. Aplicar à mão (contém secrets).
-- 08:30 UTC ≈ 09:30 Lisboa no horário de verão. Substituir placeholders.

select cron.schedule(
  'daily-alerts',
  '30 8 * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer <SERVICE_ROLE_KEY>'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- Remover:  select cron.unschedule('daily-alerts');
