-- Nomes dos separadores (grupos de categorias) editáveis por agregado:
-- {"variavel": "Dia a dia", ...}; vazio = nomes por omissão da app.
-- Idempotente — aplicada pelo workflow "Supabase deploy" (ver 0007).
alter table settings
  add column if not exists group_labels jsonb not null default '{}'::jsonb;
