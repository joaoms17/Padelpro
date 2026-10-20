-- Só existe o Santander: todo o dinheiro (incluindo o dos eventos da Joana)
-- entra diretamente na Conta Casa. Deixa de haver "por transferir",
-- acertos (settlement) e contas de origem da Joana.
-- Idempotente — aplicada pelo workflow "Supabase deploy" (ver 0007).
-- Nada é apagado: joana_source_accounts, event_payments.location/method e os
-- CHECKs (que ainda aceitam 'por_transferir', 'numerario', 'revolut') ficam
-- como estão, por histórico. joana_source_accounts deixa de ser usada.

alter table event_payments alter column location set default 'conta_casa';

-- Propostas de acerto ainda abertas já não têm ecrã nem quem as crie.
update review_items
   set status = 'resolvido', resolved_at = coalesce(resolved_at, now())
 where type = 'settlement' and status = 'aberto';
