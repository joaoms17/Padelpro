-- Conferir entradas: parte da diferença entre o pago na App1 e o que entrou
-- no Santander que o casal marcou como "não é dívida", por mês:
-- {"2026-11": 15000, ...} (cêntimos). Idempotente (ver 0007).
alter table settings
  add column if not exists joana_waivers jsonb not null default '{}'::jsonb;
