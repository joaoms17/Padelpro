# Contas a Dois

PWA pessoal do **João e da Joana** para gerir o dinheiro da casa a partir de uma
só conta (Santander), com o mínimo de trabalho manual. Lê os movimentos por open
banking, recebe pagamentos Apple Pay em tempo real, categoriza com regras + IA,
gere os eventos da Joana e mostra orçamento, sobra, poupança e almofada.

> A especificação completa está em `docs/contas-a-dois-spec.md`. A construção é
> por marcos (M1 → M10); este repositório está no **M1 (Base)**.

## Stack

- **Frontend**: React + Vite + TypeScript, TailwindCSS, Recharts, PWA
  (`vite-plugin-pwa`). Deploy no Vercel.
- **Backend**: Supabase (Postgres + RLS, Auth OTP, Edge Functions em Deno,
  `pg_cron`, secrets).
- Valores monetários em **cêntimos** (`bigint`); positivos = entrada, negativos = saída.

## Desenvolvimento

```bash
npm install
cp .env.example .env     # preencher VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm run dev              # http://localhost:5173
npm run build            # type-check + build de produção
npm run test             # testes (vitest)
npm run icons            # regenerar ícones da PWA
```

Sem `.env` a app arranca na mesma e mostra um aviso no ecrã de entrada.

## Base de dados (Supabase)

Aplicar as migrações por ordem (SQL Editor do Supabase ou `supabase db push`):

1. `supabase/migrations/0001_schema.sql` — tabelas (secção 13 da spec)
2. `supabase/migrations/0002_rls.sql` — Row-Level Security por agregado
3. `supabase/migrations/0003_bootstrap_seed.sql` — `ensure_membership()` + categorias iniciais
4. `supabase/migrations/0004_bank.sql` — suporte Enable Banking (M3)

No primeiro login, a app chama `ensure_membership()`: o primeiro utilizador
cria o agregado "Casa" (com categorias, definições e a Conta Casa) e o segundo
junta-se automaticamente. O agregado está limitado a 2 membros.

**Auth**: usar **OTP de 6 dígitos por email** (não magic link — no iPhone o link
abre no Safari e não na PWA). No Supabase: Authentication → Email → ativar OTP e
pôr `{{ .Token }}` no template. Restringir os signups aos dois emails.

## Ligação ao banco (M3 — Enable Banking)

Edge Functions em `supabase/functions/`: `eb-auth-start`, `eb-callback`, `eb-sync`.

```bash
supabase functions deploy eb-auth-start eb-callback eb-sync categorize ingest-applepay monthly-close notify ai-ask alerts
supabase secrets set EB_APP_ID=... EB_PRIVATE_KEY="$(cat chave.pem)"
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # categorização por IA (M4)
# Web Push (M9): gerar com `npx web-push generate-vapid-keys`
supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:tu@email.pt
# e pôr a VAPID_PUBLIC_KEY também no Vercel como VITE_VAPID_PUBLIC_KEY
# Crons (M3/M8/M9): aplicar supabase/cron/*.sql (eb-sync, monthly-close, weekly-summary)
```

- Registar em enablebanking.com, criar app **Production**, gerar a chave privada
  (`.pem`), redirect URL `https://<dominio-da-app>/ligar-banco/callback`, e fazer
  **Link accounts** com o Santander no Control Panel (sem isto a API não devolve contas).
- Sincronização automática 2×/dia: ativar `pg_cron` + `pg_net` e correr
  `supabase/cron/eb-sync.sql` (substituir `<PROJECT_REF>` e `<SERVICE_ROLE_KEY>`).
- Na app: Definições → Ligação ao banco → **Ligar banco** (autoriza no Santander),
  depois **Sincronizar agora** ou esperar pelo cron. Renovar antes de expirar.

## Marcos

| | Marco | Estado |
|---|---|---|
| M1 | Base: auth OTP, agregado, PWA, visual, categorias, Definições | ✅ feito |
| M2 | Movimentos: manual, importar extrato, lista, edição, divisão | ✅ feito |
| M3 | Santander via Enable Banking (sync 2×/dia, saldo, renovar) | ✅ feito |
| M4 | Categorização: regras, histórico, IA, Por rever | ✅ feito |
| M5 | Apple Pay: Atalho + `ingest-applepay` + reconciliação | ✅ feito |
| M6 | Orçamentos, fixas recorrentes, alertas | ✅ feito |
| M7 | Eventos da Joana e pagamentos | ✅ feito |
| M8 | Métricas, almofada, previsão, objetivos, fecho do mês | ✅ feito |
| M9 | Notificações Web Push | ✅ feito |
| M10 | IA: pergunta à app e resumo do fecho | ✅ feito |

## Checklist do João (configuração inicial)

- [ ] Criar projeto no **Supabase** e no **Vercel**
- [ ] Aplicar as migrações e ativar OTP por email
- [ ] Preencher `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` no Vercel
- [ ] Registo na **Enable Banking**, aplicação Production, `.pem`, Application ID,
      **Link accounts** com o Santander (M3)
- [ ] Chave da **Anthropic API** nos secrets das Edge Functions (M4/M10)
- [ ] Gerar chaves **VAPID** (M9)
- [ ] Joana como cotitular no Santander
- [ ] Instalar a PWA nos dois iPhones e criar o Atalho "Transação" (M5)
