# Deploy — Contas a Dois

Guia passo-a-passo para pôr a app no ar. Faz-se uma vez.

## 1. Supabase (base de dados + auth + funções)

1. **Criar projeto** em [supabase.com](https://supabase.com) → New project (região Europa).
   Guarda a password da base de dados.
2. **Base de dados**: SQL Editor → cola e corre `supabase/setup.sql` (junta as 6
   migrações). Cria tabelas, RLS, `ensure_membership()`, categorias e extras.
3. **Auth (email + password)**: Authentication → Sign In / Providers → **Email**
   ativado, e **desligar "Confirm email"** (para entrar sem precisar de email).
   Não é preciso SMTP nem editar templates. Depois de os dois criarem conta,
   podes desligar novos signups.
4. **Extensões** (Database → Extensions): ativar `pg_cron` e `pg_net`.
5. **Edge Functions** (precisa do [Supabase CLI](https://supabase.com/docs/guides/cli)):
   ```bash
   supabase link --project-ref <REF>
   supabase functions deploy eb-auth-start eb-callback eb-sync categorize \
     ingest-applepay monthly-close notify ai-ask alerts
   ```
6. **Secrets** das funções:
   ```bash
   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   supabase secrets set EB_APP_ID=... EB_PRIVATE_KEY="$(cat chave.pem)"
   # Web Push — gerar com: npx web-push generate-vapid-keys
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... \
     VAPID_SUBJECT=mailto:tu@email.pt
   ```
7. **Crons** (SQL Editor, substituir `<PROJECT_REF>` e `<SERVICE_ROLE_KEY>`):
   corre `supabase/cron/eb-sync.sql`, `monthly-close.sql`, `weekly-summary.sql`
   e `alerts.sql`.

Guarda, de Settings → API: **Project URL**, **anon/publishable key** e
**service_role key**.

## 2. Vercel (frontend PWA)

1. **Novo projeto** a apontar para o repo `joaoms17/Padelpro`.
2. **Root Directory** = `.` · **Framework** = Vite · Build `npm run build` ·
   Output `dist`. (O `vercel.json` do repo já trata do routing da SPA.)
3. **Environment Variables** (Production + Preview):
   - `VITE_SUPABASE_URL` = Project URL do Supabase
   - `VITE_SUPABASE_ANON_KEY` = anon/publishable key
   - `VITE_JOAO_EMAIL` = email do João · `VITE_JOANA_EMAIL` = email da Joana
     (definem a identidade e recusam qualquer outro email)
   - `VITE_VAPID_PUBLIC_KEY` = a chave pública VAPID (só na Fase D)
4. Deploy → fica `https://…vercel.app`.

> O projeto Vercel antigo (`padelpro-dashboard`) aponta para o código antigo e
> falha — apaga-o ou reconfigura-o com o acima.

## 3. Enable Banking (Santander — M3)

1. Registar em [enablebanking.com](https://enablebanking.com), confirmar email.
2. Control Panel → API Applications → nova app em **Production**; gerar a chave
   privada no browser (descarrega `.pem`); redirect URL
   `https://<dominio-vercel>/ligar-banco/callback`. Guardar o **Application ID**.
3. **Link accounts**: ligar o Santander e autorizar (sem isto a API não devolve contas).
4. Os secrets (`EB_APP_ID`, `EB_PRIVATE_KEY`) já foram definidos no passo 1.6.

## 4. iPhones

1. Abrir o link Vercel no Safari → Partilhar → **Adicionar ao ecrã principal**.
2. Abrir a app a partir do ícone, entrar com o código por email.
3. Definições → Notificações → **Ativar** (permissão de notificações).
4. Definições → Atalho Apple Pay → gerar token e criar a automação "Transação"
   (passos no ecrã).

## 5. Valores a preencher (na app)

Definições → Dinheiro: mesadas (valor + dia), alvo da almofada, tabela de preços
dos eventos, taxa de reserva para impostos. Orçamento: limites por categoria.

## Verificar

- `npm run build` e `npm run test` passam (CI corre-os em cada PR).
- Login aparece → código por email → entras.
- Importar um extrato (Movimentos → Importar) popula a app sem precisar do banco.
