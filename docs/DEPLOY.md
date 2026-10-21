# Deploy — Contas a Dois

Guia passo-a-passo para pôr a app no ar. Faz-se uma vez.

## 1. Supabase (base de dados + auth + funções)

1. **Criar projeto** em [supabase.com](https://supabase.com) → New project (região Europa).
   Guarda a password da base de dados.
2. **Base de dados**: SQL Editor → cola e corre `supabase/setup.sql` (junta as
   migrações 0001–0012). Cria tabelas, RLS, `ensure_membership()`, categorias e extras.
3. **Auth (email + password)**: Authentication → Sign In / Providers → **Email**
   ativado, e **desligar "Confirm email"** (para entrar sem precisar de email).
   Não é preciso SMTP nem editar templates. Depois de os dois criarem conta,
   podes desligar novos signups.
4. **Funções, secrets e crons — automático** (GitHub Actions, sem instalar nada):
   - Cria um token em [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).
   - No GitHub: repo → Settings → Secrets and variables → Actions → **New repository secret**:

     | Secret | Para quê |
     |---|---|
     | `SUPABASE_ACCESS_TOKEN` | obrigatório — o token acima |
     | `GEMINI_API_KEY` | Fase B — categorização IA ([aistudio.google.com](https://aistudio.google.com) → Get API key, grátis; ou `ANTHROPIC_API_KEY` em alternativa) |
     | `EB_APP_ID` | Fase C — Application ID da Enable Banking |
     | `EB_PRIVATE_KEY` | Fase C — conteúdo do `.pem` (colar tal como está) |
     | `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT` | Fase D — notificações push |

   - Actions → **Supabase deploy** → **Run workflow**. O workflow
     (`.github/workflows/supabase-deploy.yml`) faz deploy das 9 funções, copia os
     secrets para o Supabase, ativa `pg_cron`/`pg_net`, guarda o segredo dos crons
     no Vault, agenda os crons (`supabase/cron/schedule.sql`) e testa tudo
     (resumo no fim do run). Volta a correr sozinho a cada alteração ao backend
     na `main`.
   - Modelo Gemini por omissão: `gemini-3.5-flash-lite` (categorização). Para
     trocar: variável do repo `GEMINI_MODEL_FAST`.

Guarda, de Settings → API: **Project URL** e **anon/publishable key** (para a
Vercel). A service_role/secret key nunca sai do Supabase.

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
4. Pôr `EB_APP_ID` e `EB_PRIVATE_KEY` nos secrets do GitHub (passo 1.4) e
   correr o workflow — o teste "Enable Banking: Santander encontrado" confirma.
5. Na app: Definições → Ligação ao banco → **Ligar banco**. Faz este passo no
   Safari (ou no computador), não na app instalada: o banco volta ao browser.

## 4. iPhones

1. Abrir o link Vercel no Safari → Partilhar → **Adicionar ao ecrã principal**.
2. Abrir a app a partir do ícone, criar conta (email + password) — só os
   dois emails definidos na Vercel são aceites.
3. Definições → Notificações → **Ativar** (permissão de notificações).
4. Definições → Atalho Apple Pay → gerar token e criar a automação "Transação"
   (passos no ecrã).

## 5. Valores a preencher (na app)

Definições → Mesadas: valor e dia de cada um. Orçamento: limites por categoria.

## Verificar

- `npm run build` e `npm run test` passam (CI corre-os em cada PR).
- Login aparece → email + password → entras (e a sessão fica guardada).
- Actions → Supabase deploy: o resumo do run mostra ✅ em cada teste.
- Importar um extrato (Movimentos → Importar) popula a app sem precisar do banco.
